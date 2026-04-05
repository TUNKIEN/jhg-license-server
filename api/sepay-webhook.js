const supabase = require('../lib/supabase')

/**
 * SePay Webhook — tự động tạo license khi nhận tiền.
 *
 * Khách chuyển khoản với nội dung: email (vd: user@gmail.com)
 * SePay gọi webhook này → server tạo/gia hạn license 30 ngày.
 *
 * SePay webhook format:
 * {
 *   "gateway": "...",
 *   "transactionDate": "...",
 *   "accountNumber": "...",
 *   "transferType": "in",
 *   "transferAmount": 100000,
 *   "content": "user@gmail.com",
 *   ...
 * }
 */

// Giá và số ngày tương ứng
const PRICE_PLANS = [
  { min: 490000, max: 999999, days: 30 },        // 490k-999k = 1 tháng
  { min: 1000000, max: 1999999, days: 90 },      // 1tr-1.99tr = 3 tháng
  { min: 2000000, max: 3999999, days: 180 },     // 2tr-3.99tr = 6 tháng
  { min: 4000000, max: Infinity, days: 365 },    // 4tr+ = 1 năm
]

function getDays(amount) {
  for (const plan of PRICE_PLANS) {
    if (amount >= plan.min && amount <= plan.max) {
      return plan.days
    }
  }
  return 0
}

async function extractEmailAndDiscord(content) {
  let discordUserId = null

  // Cách 1: Tìm email trực tiếp trong nội dung
  const emailMatch = content.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/)
  if (emailMatch) return { email: emailMatch[0].toLowerCase(), discordUserId }

  // Cách 2: Tìm mã JHG trong nội dung → tra DB tìm email + discord ID
  const codeMatch = content.match(/JHG[A-Z0-9]+/i)
  if (codeMatch) {
    const code = codeMatch[0].toUpperCase()
    const { data } = await supabase
      .from('licenses')
      .select('email, note')
      .like('note', `%${code}%`)
      .single()
    if (data) {
      // Extract discord ID từ note: "pending:JHGXXX:discord:123456"
      const discordMatch = (data.note || '').match(/discord:(\d+)/)
      if (discordMatch) discordUserId = discordMatch[1]
      return { email: data.email, discordUserId }
    }
  }

  return { email: null, discordUserId: null }
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'POST only' })
  }

  // Verify SePay webhook (optional: check API key header)
  const sePayKey = req.headers['authorization'] || req.headers['x-sepay-key'] || ''
  if (process.env.SEPAY_WEBHOOK_SECRET && sePayKey !== process.env.SEPAY_WEBHOOK_SECRET) {
    return res.status(403).json({ success: false, message: 'unauthorized' })
  }

  const body = req.body
  console.log('[SePay Webhook]', JSON.stringify(body))

  // Chống duplicate: check transaction ID hoặc reference
  const txnId = body.id || body.referenceNumber || `${body.transactionDate}_${body.transferAmount}_${body.content}`
  const { data: existingTxn } = await supabase
    .from('licenses')
    .select('id')
    .like('note', `%txn:${txnId}%`)
    .single()
  if (existingTxn) {
    console.log('[SePay] Duplicate webhook, bỏ qua:', txnId)
    return res.json({ success: true, message: 'duplicate ignored' })
  }

  // Chỉ xử lý giao dịch tiền vào
  if (body.transferType !== 'in') {
    return res.json({ success: true, message: 'ignored (not incoming)' })
  }

  const amount = parseInt(body.transferAmount) || 0
  const content = (body.content || '').trim()

  // Tìm email + discord user ID trong nội dung
  const { email, discordUserId } = await extractEmailAndDiscord(content)
  if (!email) {
    console.log('[SePay] Không tìm thấy email trong nội dung:', content)
    return res.json({ success: false, message: 'no email found in content' })
  }

  // Tính số ngày theo số tiền
  const days = getDays(amount)
  if (days === 0) {
    console.log('[SePay] Số tiền không hợp lệ:', amount)
    return res.json({ success: false, message: 'invalid amount' })
  }

  // Tạo hoặc gia hạn license
  const { data: existing } = await supabase
    .from('licenses')
    .select('id, expires_at')
    .eq('email', email)
    .single()

  let expires_at
  if (existing && existing.expires_at && new Date(existing.expires_at) > new Date()) {
    // Gia hạn từ ngày hết hạn hiện tại
    expires_at = new Date(existing.expires_at)
    expires_at.setDate(expires_at.getDate() + days)
  } else {
    // Tạo mới từ hôm nay
    expires_at = new Date()
    expires_at.setDate(expires_at.getDate() + days)
  }

  if (existing) {
    await supabase
      .from('licenses')
      .update({ expires_at: expires_at.toISOString(), status: 'active', note: `SePay ${amount}đ txn:${txnId}` })
      .eq('email', email)
  } else {
    await supabase
      .from('licenses')
      .insert({
        email,
        status: 'active',
        expires_at: expires_at.toISOString(),
        note: `SePay ${amount}đ txn:${txnId}`
      })
  }

  console.log(`[SePay] License ${existing ? 'gia hạn' : 'tạo mới'}: ${email}, ${days} ngày, hết hạn ${expires_at.toISOString()}`)

  const expDate = expires_at.toLocaleDateString('vi-VN')

  // 1. Gửi thông báo cho ADMIN (webhook channel admin)
  if (process.env.DISCORD_WEBHOOK_URL) {
    try {
      await fetch(process.env.DISCORD_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          embeds: [{
            title: '💰 Có người thanh toán mới',
            color: 0xFF9800,
            fields: [
              { name: 'Email', value: email, inline: true },
              { name: 'User Discord', value: discordUserId ? `<@${discordUserId}>` : 'N/A', inline: true },
              { name: 'Số tiền', value: `${amount.toLocaleString()}đ`, inline: true },
              { name: 'Gói', value: `${days} ngày`, inline: true },
              { name: 'Hết hạn', value: expDate, inline: true },
              { name: 'Loại', value: existing ? 'Gia hạn' : 'Mới', inline: true },
            ],
            footer: { text: 'JHG Tool Payment - Admin' },
            timestamp: new Date().toISOString()
          }]
        })
      })
    } catch (e) {
      console.log('[SePay] Admin notify error:', e.message)
    }
  }

  // 2. Gửi thông báo cho USER trong channel thanh toán (mention)
  if (discordUserId && process.env.DISCORD_WEBHOOK_URL) {
    try {
      await fetch(process.env.DISCORD_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: `<@${discordUserId}>`,
          embeds: [{
            title: '✅ Thanh toán thành công!',
            description: 'License đã được kích hoạt. Mở JHGTOOL → nhập email để sử dụng.',
            color: 0x4CAF50,
            fields: [
              { name: 'Email', value: email, inline: true },
              { name: 'Gói', value: `${days} ngày`, inline: true },
              { name: 'Hết hạn', value: expDate, inline: true },
            ],
            footer: { text: 'JHG Tool Payment' },
            timestamp: new Date().toISOString()
          }]
        })
      })
    } catch (e) {
      console.log('[SePay] User notify error:', e.message)
    }
  }

  return res.json({
    success: true,
    message: `License ${existing ? 'gia hạn' : 'tạo mới'} thành công`,
    email,
    days,
    expires_at: expires_at.toISOString()
  })
}

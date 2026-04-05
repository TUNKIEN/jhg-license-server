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
  { min: 99000, max: 150000, days: 30 },   // ~100k = 30 ngày
  { min: 150001, max: 300000, days: 90 },   // ~200k = 90 ngày
  { min: 300001, max: 999999, days: 180 },  // ~500k = 180 ngày
  { min: 1000000, max: Infinity, days: 365 }, // 1tr+ = 1 năm
]

function getDays(amount) {
  for (const plan of PRICE_PLANS) {
    if (amount >= plan.min && amount <= plan.max) {
      return plan.days
    }
  }
  return 0
}

function extractEmail(content) {
  // Tìm email trong nội dung chuyển khoản
  const match = content.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/)
  return match ? match[0].toLowerCase() : null
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

  // Chỉ xử lý giao dịch tiền vào
  if (body.transferType !== 'in') {
    return res.json({ success: true, message: 'ignored (not incoming)' })
  }

  const amount = parseInt(body.transferAmount) || 0
  const content = (body.content || '').trim()

  // Tìm email trong nội dung
  const email = extractEmail(content)
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
      .update({ expires_at: expires_at.toISOString(), status: 'active' })
      .eq('email', email)
  } else {
    await supabase
      .from('licenses')
      .insert({
        email,
        status: 'active',
        expires_at: expires_at.toISOString(),
        note: `SePay auto - ${amount}đ`
      })
  }

  console.log(`[SePay] License ${existing ? 'gia hạn' : 'tạo mới'}: ${email}, ${days} ngày, hết hạn ${expires_at.toISOString()}`)

  return res.json({
    success: true,
    message: `License ${existing ? 'gia hạn' : 'tạo mới'} thành công`,
    email,
    days,
    expires_at: expires_at.toISOString()
  })
}

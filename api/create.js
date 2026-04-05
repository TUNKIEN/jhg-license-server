const supabase = require('../lib/supabase')

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'POST only' })
  }

  const { email, days, secret } = req.body

  // Admin auth
  if (secret !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ success: false, message: 'unauthorized' })
  }

  if (!email) {
    return res.status(400).json({ success: false, message: 'email required' })
  }

  const daysNum = parseInt(days) || 0
  const note = req.body.note || ''

  const expires_at = daysNum > 0 ? new Date() : null
  if (expires_at) expires_at.setDate(expires_at.getDate() + daysNum)

  // Upsert: tạo mới hoặc gia hạn nếu đã có
  const { data: existing } = await supabase
    .from('licenses')
    .select('id')
    .eq('email', email)
    .single()

  if (existing) {
    // Gia hạn hoặc update note
    const updateData = { status: 'active' }
    if (expires_at) updateData.expires_at = expires_at.toISOString()
    if (note) updateData.note = note

    const { error } = await supabase
      .from('licenses')
      .update(updateData)
      .eq('email', email)

    if (error) {
      return res.status(500).json({ success: false, message: error.message })
    }

    return res.json({
      success: true,
      message: expires_at ? 'Đã gia hạn' : 'Đã cập nhật',
      email,
      expires_at: expires_at ? expires_at.toISOString() : null
    })
  }

  // Tạo mới
  const { error } = await supabase
    .from('licenses')
    .insert({
      email,
      status: daysNum > 0 ? 'active' : 'pending',
      expires_at: expires_at ? expires_at.toISOString() : null,
      note
    })

  if (error) {
    return res.status(500).json({ success: false, message: error.message })
  }

  return res.json({
    success: true,
    message: 'Đã tạo license',
    email,
    expires_at: expires_at ? expires_at.toISOString() : null
  })
}

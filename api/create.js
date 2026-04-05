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

  if (!email || !days) {
    return res.status(400).json({ success: false, message: 'email and days required' })
  }

  const expires_at = new Date()
  expires_at.setDate(expires_at.getDate() + parseInt(days))

  // Upsert: tạo mới hoặc gia hạn nếu đã có
  const { data: existing } = await supabase
    .from('licenses')
    .select('id')
    .eq('email', email)
    .single()

  if (existing) {
    // Gia hạn
    const { error } = await supabase
      .from('licenses')
      .update({ expires_at: expires_at.toISOString(), status: 'active' })
      .eq('email', email)

    if (error) {
      return res.status(500).json({ success: false, message: error.message })
    }

    return res.json({
      success: true,
      message: 'Đã gia hạn',
      email,
      expires_at: expires_at.toISOString()
    })
  }

  // Tạo mới
  const { error } = await supabase
    .from('licenses')
    .insert({
      email,
      status: 'active',
      expires_at: expires_at.toISOString()
    })

  if (error) {
    return res.status(500).json({ success: false, message: error.message })
  }

  return res.json({
    success: true,
    message: 'Đã tạo license',
    email,
    expires_at: expires_at.toISOString()
  })
}

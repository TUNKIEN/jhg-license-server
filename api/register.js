const supabase = require('../lib/supabase')

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'POST only' })
  }

  const { email, hardware_key } = req.body

  if (!email || !hardware_key) {
    return res.status(400).json({ success: false, message: 'email and hardware_key required' })
  }

  // Check license exists
  const { data: license } = await supabase
    .from('licenses')
    .select('*')
    .eq('email', email)
    .single()

  if (!license) {
    return res.json({ success: false, message: 'email chưa đăng ký' })
  }

  if (license.status !== 'active') {
    return res.json({ success: false, message: 'tài khoản không hoạt động' })
  }

  // Check expiration
  if (license.expires_at && new Date(license.expires_at) < new Date()) {
    return res.json({ success: false, message: 'email hết hạn' })
  }

  // Nếu đã có hardware_key khác → cần reset trước
  if (license.hardware_key && license.hardware_key !== hardware_key) {
    return res.json({ success: false, message: 'vui lòng reset key' })
  }

  // Đăng ký hardware_key
  const { error } = await supabase
    .from('licenses')
    .update({
      hardware_key,
      activated_at: new Date().toISOString()
    })
    .eq('email', email)

  if (error) {
    return res.status(500).json({ success: false, message: 'database error' })
  }

  return res.json({ success: true, message: 'Đăng ký máy thành công' })
}

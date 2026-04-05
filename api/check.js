const supabase = require('../lib/supabase')

module.exports = async (req, res) => {
  const { email, hardware_key } = req.query

  if (!email) {
    return res.status(400).json({ success: false, message: 'email required' })
  }

  const { data, error } = await supabase
    .from('licenses')
    .select('*')
    .eq('email', email)
    .single()

  if (error || !data) {
    return res.json({ success: false, message: 'email chưa đăng ký' })
  }

  // Check status
  if (data.status !== 'active') {
    return res.json({ success: false, message: 'tài khoản không hoạt động' })
  }

  // Check expiration
  if (data.expires_at && new Date(data.expires_at) < new Date()) {
    return res.json({ success: false, message: 'email hết hạn' })
  }

  // Check hardware key match (nếu đã đăng ký máy)
  if (data.hardware_key && hardware_key && data.hardware_key !== hardware_key) {
    return res.json({ success: false, message: 'vui lòng reset key' })
  }

  return res.json({
    success: true,
    data: {
      key: data.hardware_key,
      status: data.status,
      created_at: data.created_at,
      activated_at: data.activated_at,
      expires_at: data.expires_at
    }
  })
}

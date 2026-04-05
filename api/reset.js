const supabase = require('../lib/supabase')

module.exports = async (req, res) => {
  const email = req.query.email || (req.body && req.body.email)

  if (!email) {
    return res.status(400).json({ success: false, message: 'email required' })
  }

  const { data, error } = await supabase
    .from('licenses')
    .update({ hardware_key: null })
    .eq('email', email)
    .select()

  if (error) {
    return res.status(500).json({ success: false, message: 'database error' })
  }

  if (!data || data.length === 0) {
    return res.json({ success: false, message: 'email không tồn tại' })
  }

  return res.json({ success: true, message: 'Đã reset key' })
}

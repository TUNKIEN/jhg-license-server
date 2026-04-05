const supabase = require('../lib/supabase')

/**
 * Kiểm tra license hết hạn → gỡ role Discord.
 * Gọi định kỳ bằng cron (Vercel Cron hoặc bên ngoài).
 * GET /api/check-expired?secret=xxx
 */
module.exports = async (req, res) => {
  const { secret } = req.query

  if (secret !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ success: false, message: 'unauthorized' })
  }

  const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN
  const GUILD_ID = process.env.DISCORD_GUILD_ID
  const ROLE_ID = '1366362020017995887'

  if (!BOT_TOKEN || !GUILD_ID) {
    return res.status(400).json({ success: false, message: 'missing env vars' })
  }

  // Tìm tất cả license đã hết hạn
  const { data: expired } = await supabase
    .from('licenses')
    .select('email, note')
    .eq('status', 'active')
    .lt('expires_at', new Date().toISOString())

  if (!expired || expired.length === 0) {
    return res.json({ success: true, message: 'Không có license hết hạn', removed: 0 })
  }

  let removed = 0

  for (const license of expired) {
    // Tìm discord ID từ note
    const discordMatch = (license.note || '').match(/discord:(\d+)/)
    if (discordMatch) {
      const userId = discordMatch[1]
      try {
        await fetch(`https://discord.com/api/v10/guilds/${GUILD_ID}/members/${userId}/roles/${ROLE_ID}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bot ${BOT_TOKEN}` }
        })
        console.log(`[Expired] Gỡ role: ${license.email} (${userId})`)
        removed++
        await new Promise(r => setTimeout(r, 200))
      } catch (e) {
        console.log(`[Expired] Lỗi gỡ role ${userId}:`, e.message)
      }
    }

    // Đổi status thành expired
    await supabase
      .from('licenses')
      .update({ status: 'expired' })
      .eq('email', license.email)
  }

  return res.json({
    success: true,
    message: `Đã gỡ role ${removed} users, ${expired.length} licenses hết hạn`,
    removed,
    total_expired: expired.length
  })
}

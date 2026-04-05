module.exports = async (req, res) => {
  const { secret } = req.query

  if (secret !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ success: false, message: 'unauthorized' })
  }

  const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN
  const GUILD_ID = process.env.DISCORD_GUILD_ID
  const ROLE_ID = '1366362020017995887'

  if (!BOT_TOKEN || !GUILD_ID) {
    return res.status(400).json({ success: false, message: 'missing DISCORD_BOT_TOKEN or DISCORD_GUILD_ID' })
  }

  try {
    // Lấy danh sách members có role
    let removed = 0
    let after = null

    while (true) {
      const url = `https://discord.com/api/v10/guilds/${GUILD_ID}/members?limit=100${after ? `&after=${after}` : ''}`
      const resp = await fetch(url, {
        headers: { 'Authorization': `Bot ${BOT_TOKEN}` }
      })
      const members = await resp.json()

      if (!Array.isArray(members) || members.length === 0) break

      for (const member of members) {
        if (member.roles && member.roles.includes(ROLE_ID)) {
          await fetch(`https://discord.com/api/v10/guilds/${GUILD_ID}/members/${member.user.id}/roles/${ROLE_ID}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bot ${BOT_TOKEN}` }
          })
          removed++
          // Rate limit: chờ 200ms giữa mỗi request
          await new Promise(r => setTimeout(r, 200))
        }
      }

      after = members[members.length - 1].user.id
      if (members.length < 100) break
    }

    return res.json({ success: true, message: `Đã xóa role khỏi ${removed} members` })
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message })
  }
}

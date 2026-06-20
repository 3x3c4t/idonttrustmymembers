require("dotenv").config()
const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionsBitField
} = require("discord.js")

const sqlite3 = require("sqlite3").verbose()
const db = new sqlite3.Database("data.db")

db.run(`
CREATE TABLE IF NOT EXISTS bans(
userId TEXT,
guildId TEXT,
reason TEXT,
date INTEGER,
PRIMARY KEY(userId,guildId)
)
`)

const client = new Client({
  intents: 131071
})

const userGuildCache = new Map()

function addUserToCache(userId, guildId) {
  if (!userGuildCache.has(userId)) userGuildCache.set(userId, new Set())
  userGuildCache.get(userId).add(guildId)
}

function getSharedServers(userId) {
  return Array.from(userGuildCache.get(userId) || [])
}

function upsertBan(userId, guildId, reason, date) {
  db.run(
    "INSERT INTO bans(userId,guildId,reason,date) VALUES (?,?,?,?) ON CONFLICT(userId,guildId) DO UPDATE SET reason=excluded.reason, date=excluded.date",
    [userId, guildId, reason, date]
  )
}

function query(sql, params = []) {
  return new Promise((res, rej) => {
    db.all(sql, params, (err, rows) => {
      if (err) rej(err)
      else res(rows)
    })
  })
}

function risk(n) {
  if (n > 20) return "🔴 HIGH"
  if (n > 5) return "🟠 MEDIUM"
  return "🟢 LOW"
}

async function createChannel(guild) {
  try {
    const existing = guild.channels.cache.find(c => c.name === "idonttrustmymembers")
    if (existing) return existing

    const channel = await guild.channels.create({
      name: "idonttrustmymembers",
      type: 0,
      permissionOverwrites: [
        {
          id: guild.roles.everyone.id,
          deny: [PermissionsBitField.Flags.ViewChannel]
        }
      ]
    })

    const embed = new EmbedBuilder()
      .setTitle("🛡 IDon'tTrustMyMembers — Security System")
      .setColor(0x3498db)
      .setDescription(
        "This channel is the **security dashboard** of your server.\n\n" +
        "We analyze users using a cross-server ban database.\n\n" +
        "When a member joins, we calculate a **risk score** based on:\n" +
        "• Ban history across all servers\n" +
        "• Number of affected communities\n" +
        "• Shared server presence\n\n" +
        "Use `/lookup` to manually check any user."
      )
      .addFields(
        {
          name: "⚡ Purpose",
          value: "Detect potentially risky users before they interact"
        },
        {
          name: "🧠 Risk levels",
          value: "🟢 Safe • 🟠 Suspicious • 🔴 High risk"
        }
      )
      .setFooter({ text: "IDTMM Security Network" })
      .setTimestamp()

    const row = {
      components: [
        {
          type: 1,
          components: [
            {
              type: 2,
              style: 5,
              label: "📘 Docs",
              url: "https://example.com/docs"
            },
            {
              type: 2,
              style: 5,
              label: "💬 Support",
              url: "https://example.com/support"
            },
            {
              type: 2,
              style: 5,
              label: "🌐 Website",
              url: "https://example.com"
            }
          ]
        }
      ]
    }

    await channel.send({
      embeds: [embed],
      components: row.components
    })

    return channel
  } catch {
    return null
  }
}

async function smartBanSync(guild) {
  try {
    const bans = await guild.bans.fetch()

    for (const b of bans.values()) {
      upsertBan(
        b.user.id,
        guild.id,
        b.reason || "unknown",
        Date.now()
      )
    }
  } catch {}
}

async function buildInitialCache() {
  for (const g of client.guilds.cache.values()) {
    try {
      const members = await g.members.fetch().catch(() => null)
      if (!members) continue

      for (const m of members.values()) {
        addUserToCache(m.id, g.id)
      }
    } catch {}
  }
}

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(process.env.TOKEN)

  const commands = [
    new SlashCommandBuilder()
      .setName("lookup")
      .setDescription("Lookup a user in the trust network")
      .addUserOption(o => o.setName("user").setDescription("User"))
      .addStringOption(o => o.setName("id").setDescription("User ID"))
  ].map(c => c.toJSON())

  await rest.put(
    Routes.applicationCommands(process.env.CLIENT_ID),
    { body: commands }
  )
}

client.once("ready", async () => {
  await registerCommands()
  await buildInitialCache()

  setInterval(() => {
    for (const g of client.guilds.cache.values()) {
      smartBanSync(g)
    }
  }, 1000 * 60 * 30)

  console.log(`Logged in as ${client.user.tag}`)
})

client.on("guildMemberAdd", async member => {
  addUserToCache(member.id, member.guild.id)

  const bans = await query("SELECT * FROM bans WHERE userId=?", [member.id])
  const shared = getSharedServers(member.id)

  const embed = new EmbedBuilder()
    .setTitle("📥 Member Joined — Risk Report")
    .setColor(bans.length ? 0xff3b3b : 0x2ecc71)
    .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
    .addFields(
      { name: "👤 User", value: `${member.user.tag} (${member.id})` },
      { name: "⚠️ Risk", value: risk(bans.length), inline: true },
      { name: "📊 Ban count", value: String(bans.length), inline: true },
      { name: "🧠 Shared servers", value: String(shared.length), inline: true }
    )
    .setTimestamp()

  const channel = member.guild.channels.cache.find(c => c.name === "idonttrustmymembers")
  if (channel) channel.send({ embeds: [embed] })
})

client.on("guildCreate", async guild => {
  await createChannel(guild)
  await smartBanSync(guild)
})

client.on("guildBanAdd", b => {
  upsertBan(b.user.id, b.guild.id, b.reason || "unknown", Date.now())
})

client.on("guildBanRemove", b => {
  db.run("DELETE FROM bans WHERE userId=? AND guildId=?", [b.user.id, b.guild.id])
})

client.on("interactionCreate", async i => {
  if (!i.isChatInputCommand()) return
  if (i.commandName !== "lookup") return

  if (!i.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
    return i.reply({ content: "❌ Admin only command.", ephemeral: true })
  }

  let user = i.options.getUser("user")
  let id = i.options.getString("id")

  if (!user && !id) {
    return i.reply({ content: "❌ Provide user or ID", ephemeral: true })
  }

  if (user) id = user.id

  let target = user
  if (!target) {
    try {
      target = await client.users.fetch(id)
    } catch {
      target = null
    }
  }

  const bans = await query("SELECT * FROM bans WHERE userId=?", [id])
  const shared = getSharedServers(id)

  const embed = new EmbedBuilder()
    .setTitle("🛡 IDon'tTrustMyMembers Lookup")
    .setColor(bans.length ? 0xff3b3b : 0x2ecc71)
    .setThumbnail(target?.displayAvatarURL({ size: 256 }) || null)
    .addFields(
      { name: "👤 User", value: target ? `${target.tag} (${target.id})` : id },
      { name: "📊 Ban count", value: String(bans.length), inline: true },
      { name: "🌍 Servers banned", value: String(new Set(bans.map(b => b.guildId)).size), inline: true },
      { name: "🧠 Shared servers", value: String(shared.length), inline: true },
      { name: "⚠️ Risk", value: risk(bans.length), inline: true },
      {
        name: "📌 Recent cases",
        value:
          bans.slice(0, 10).map(b => {
            const date = b.date ? new Date(b.date).toLocaleString() : "unknown"
            return `• ${b.guildId} → ${b.reason} • ${date}`
          }).join("\n") || "Clean"
      }
    )
    .setTimestamp()

  i.reply({ embeds: [embed] })
})

client.login(process.env.TOKEN)
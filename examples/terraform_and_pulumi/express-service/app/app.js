import express from 'express'
import { Pool } from 'pg'
import cors from 'cors'

const app = express()
const port = process.env.PORT || 3000

// Middleware
app.use(cors())
app.use(express.json())

// Database connection
const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
})

// Test database connection
async function testConnection() {
  try {
    const client = await pool.connect()
    console.log('Connected to PostgreSQL database')
    client.release()
  } catch (err) {
    console.error('Database connection error:', err)
  }
}

// Initialize database with a simple table
async function initDatabase() {
  try {
    const client = await pool.connect()
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `)
    console.log('Database initialized')
    client.release()
  } catch (err) {
    console.error('Database initialization error:', err)
  }
}

// Routes
app.get('/', (req, res) => {
  res.json({
    message: 'Express.js API with PostgreSQL',
    status: 'running',
    timestamp: new Date().toISOString(),
  })
})

app.get('/health', async (req, res) => {
  try {
    const client = await pool.connect()
    await client.query('SELECT NOW()')
    client.release()
    res.json({
      status: 'healthy',
      database: 'connected',
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    res.status(500).json({
      status: 'unhealthy',
      database: 'disconnected',
      error: err.message,
      timestamp: new Date().toISOString(),
    })
  }
})

app.get('/users', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM users ORDER BY created_at DESC')
    res.json(result.rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/users', async (req, res) => {
  try {
    const { name, email } = req.body
    if (!name || !email) {
      return res.status(400).json({ error: 'Name and email are required' })
    }

    const result = await pool.query('INSERT INTO users (name, email) VALUES ($1, $2) RETURNING *', [name, email])
    res.status(201).json(result.rows[0])
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Start server
app.listen(port, async () => {
  console.log(`Express.js server running on port ${port}`)
  await testConnection()
  await initDatabase()
})

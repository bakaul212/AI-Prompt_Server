const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken'); // জেসন ওয়েব টোকেন ইমপোর্ট করা হলো
require('dotenv').config();
const { MongoClient, ServerApiVersion } = require('mongodb');

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB Connection
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // ডাটাবেজ এবং কালেকশন ডিক্লেয়ারেশন
    const db = client.db("aiPromptDB");
    const usersCollection = db.collection("users");

    // ---- Authentication API (JWT Generation) ----
    app.post('/jwt', async (req, res) => {
      const user = req.body; // ইউজারের ইমেইল আসবে ক্লায়েন্ট থেকে
      const token = jwt.sign(user, process.env.JWT_SECRET, { expiresIn: '7d' });
      res.send({ token });
    });

    // ---- User Registration / Save User to DB ----
    app.post('/users', async (req, res) => {
      const user = req.body;
      
      // ইউজার অলরেডি ডাটাবেজে আছে কিনা চেক করা (গুগল লগইনের ক্ষেত্রে এটি দরকারি)
      const query = { email: user.email };
      const existingUser = await usersCollection.findOne(query);
      if (existingUser) {
        return res.send({ message: 'user already exists', insertedId: null });
      }

      // নতুন ইউজারের ডিফল্ট রোল হবে 'User' [রিকোয়ারমেন্ট অনুযায়ী]
      const newUser = {
        name: user.name,
        email: user.email,
        photoURL: user.photoURL,
        role: 'User', // Default Role
        status: 'Free' // Free/Premium
      };

      const result = await usersCollection.insertOne(newUser);
      res.send(result);
    });

    console.log("Successfully connected to MongoDB!");
  } finally {
    // Keep running
  }
}
run().catch(console.dir);

app.get('/', (req, res) => {
  res.send('AI Prompt Marketplace Server is Running...');
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
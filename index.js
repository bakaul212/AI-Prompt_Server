// server/index.js
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
    // ডাটাবেজ এবং কালেকশন ডিক্লেয়ারেশন
    const db = client.db("aiPromptDB");
    const usersCollection = db.collection("users");
    const promptsCollection = db.collection("prompts"); // প্রম্পট কালেকশন যুক্ত করা হলো

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

      // নতুন ইউজারের ডিফল্ট রোল হবে 'User' [রিকোয়ারমেন্ট অনুযায়ী]
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

    // ---- Featured/Trending Prompts API (Limit to 6) [রিকোয়ারমেন্ট অনুযায়ী] ----
    app.get('/featured-prompts', async (req, res) => {
      try {
        // শুধুমাত্র approved এবং public প্রম্পটগুলো ফিল্টার করে সর্বোচ্চ６টি নিয়ে আসা
        const query = { status: "approved", visibility: "Public" };
        const result = await promptsCollection.find(query).limit(6).toArray(); // MongoDB limit(6)
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Error fetching featured prompts", error });
      }
    });

    // ---- All Prompts API (Search, Filter, Sort, and Pagination) ----
    app.get('/all-prompts', async (req, res) => {
      try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 6; // প্রতি পেজে ৬টি করে প্রম্পট
        const skip = (page - 1) * limit;

        const search = req.query.search || '';
        const category = req.query.category || '';
        const aiTool = req.query.aiTool || '';
        const sort = req.query.sort || '';

        // বেস কোয়েরি (শুধুমাত্র approved এবং public প্রম্পট দেখা যাবে)
        let query = { status: "approved", visibility: "Public" };

        // সার্চ ফিল্টার (Title, Description, Category, বা AI Tool-এর মধ্যে খুঁজবে)
        if (search) {
          query.$or = [
            { title: { $regex: search, $options: 'i' } },
            { description: { $regex: search, $options: 'i' } },
            { category: { $regex: search, $options: 'i' } },
            { aiTool: { $regex: search, $options: 'i' } }
          ];
        }

        // ক্যাটাগরি ফিল্টার
        if (category) {
          query.category = category;
        }

        // AI Tool ফিল্টার
        if (aiTool) {
          query.aiTool = aiTool;
        }

        // সর্টিং কন্ডিশন
        let sortOptions = {};
        if (sort === 'newest') {
          sortOptions = { _id: -1 };
        } else if (sort === 'price-low') {
          sortOptions = { price: 1 };
        } else if (sort === 'price-high') {
          sortOptions = { price: -1 };
        } else {
          sortOptions = { _id: -1 }; // ডিফল্ট নিউয়েস্ট
        }

        // ডেটা এবং টোটাল কাউন্ট একসাথে বের করা (পেজিনেশনের জন্য দরকার)
        const prompts = await promptsCollection.find(query)
          .sort(sortOptions)
          .skip(skip)
          .limit(limit)
          .toArray();

        const totalCount = await promptsCollection.countDocuments(query);

        res.send({
          prompts,
          totalCount,
          totalPages: Math.ceil(totalCount / limit),
          currentPage: page
        });

      } catch (error) {
        res.status(500).send({ message: "Error fetching prompts", error });
      }
    });

    // ---- Add New Prompt API ----
    app.post('/add-prompt', async (req, res) => {
      try {
        const promptData = req.body;
        
        // রিকোয়ারমেন্ট অনুযায়ী নতুন প্রম্পটের প্রাথমিক ডেটা স্ট্রাকচার নির্ধারণ
        const newPrompt = {
          title: promptData.title,
          description: promptData.description,
          category: promptData.category,
          aiTool: promptData.aiTool,
          priceType: promptData.priceType,
          price: promptData.priceType === 'Free' ? 0 : parseFloat(promptData.price), // Number-এ রূপান্তর
          visibility: promptData.visibility,
          creatorEmail: promptData.creatorEmail,
          creatorName: promptData.creatorName,
          status: 'pending', // ডিফল্ট স্ট্যাটাস পেন্ডিং থাকবে
          createdAt: new Date()
        };

        const result = await promptsCollection.insertOne(newPrompt);
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Failed to add prompt", error });
      }
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
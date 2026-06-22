// server/index.js
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken'); 
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb'); 

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB Connection
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.d4nhymd.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

let usersCollection;
let promptsCollection;

async function run() {
  try {
    await client.connect();
    
    const db = client.db("aiPromptDB");
    usersCollection = db.collection("users");
    promptsCollection = db.collection("prompts"); 

    console.log("Successfully connected to MongoDB!");
  } catch (err) {
    console.error("MongoDB Connection Error: ", err);
  }
}
run().catch(console.dir);

// ---- Authentication API (JWT Generation) ----
app.post('/jwt', async (req, res) => {
  try {
    const user = req.body; 
    if (!user || !user.email) {
      return res.status(400).send({ message: "Valid user data is required" });
    }
    const token = jwt.sign(user, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.send({ token });
  } catch (error) {
    res.status(500).send({ message: "JWT Generation Failed", error: error.message });
  }
});

// ---- User Registration / Save User to DB ----
app.post('/users', async (req, res) => {
  try {
    const user = req.body;
    if (!user || !user.email) {
      return res.status(400).send({ message: "Email is required" });
    }
    if (!usersCollection) {
      return res.status(500).send({ message: "Database not ready yet" });
    }
    
    const query = { email: user.email };
    const existingUser = await usersCollection.findOne(query);
    if (existingUser) {
      return res.send({ message: 'user already exists', insertedId: null });
    }

    const newUser = {
      name: user.name || "Anonymous",
      email: user.email,
      photoURL: user.photoURL || "",
      role: 'User', 
      status: 'Free', 
      createdAt: new Date()
    };

    const result = await usersCollection.insertOne(newUser);
    res.send(result);
  } catch (error) {
    res.status(500).send({ message: "Internal Server Error in /users", error: error.message });
  }
});

// ---- Featured/Trending Prompts API (Limit to 6) ----
app.get('/featured-prompts', async (req, res) => {
  try {
    if (!promptsCollection) {
      return res.send([]);
    }
    const query = { status: "approved", visibility: "Public" };
    const result = await promptsCollection.find(query).limit(6).toArray(); 
    res.send(result || []);
  } catch (error) {
    res.status(500).send({ message: "Error fetching featured prompts", error: error.message });
  }
});

// ---- All Prompts API (Search, Filter, Sort, and Pagination) ----
app.get('/all-prompts', async (req, res) => {
  try {
    if (!promptsCollection) {
      return res.status(500).send({ message: "Database not ready yet" });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 6; 
    const skip = (page - 1) * limit;

    const search = req.query.search || '';
    const category = req.query.category || '';
    const aiTool = req.query.aiTool || '';
    const sort = req.query.sort || '';

    let query = { status: "approved", visibility: "Public" };

    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { category: { $regex: search, $options: 'i' } },
        { aiTool: { $regex: search, $options: 'i' } }
      ];
    }

    if (category) { query.category = category; }
    if (aiTool) { query.aiTool = aiTool; }

    let sortOptions = {};
    if (sort === 'newest') { sortOptions = { _id: -1 }; } 
    else if (sort === 'price-low') { sortOptions = { price: 1 }; } 
    else if (sort === 'price-high') { sortOptions = { price: -1 }; } 
    else { sortOptions = { _id: -1 }; }

    const prompts = await promptsCollection.find(query)
      .sort(sortOptions)
      .skip(skip)
      .limit(limit)
      .toArray();

    const totalCount = await promptsCollection.countDocuments(query) || 0;

    res.send({
      prompts: prompts || [],
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
      currentPage: page
    });

  } catch (error) {
    res.status(500).send({ message: "Error fetching prompts", error: error.message });
  }
});

// ---- Get Single Prompt Details API ----
app.get('/prompt/:id', async (req, res) => {
  try {
    if (!promptsCollection) {
      return res.status(500).send({ message: "Database not ready yet" });
    }
    const id = req.params.id;
    const query = { _id: new ObjectId(id) };
    const result = await promptsCollection.findOne(query); 
    
    if (!result) {
      return res.status(404).send({ message: "Prompt not found" });
    }
    res.send(result);
  } catch (error) {
    res.status(500).send({ message: "Error fetching prompt details", error: error.message });
  }
});

// ---- Add New Prompt API ----
app.post('/add-prompt', async (req, res) => {
  try {
    if (!promptsCollection) {
      return res.status(500).send({ message: "Database not ready yet" });
    }

    const promptData = req.body;
    
    const newPrompt = {
      title: promptData.title,
      description: promptData.description,
      category: promptData.category,
      aiTool: promptData.aiTool,
      priceType: promptData.priceType,
      price: promptData.priceType === 'Free' ? 0 : parseFloat(promptData.price) || 0, 
      visibility: promptData.visibility,
      creatorEmail: promptData.creatorEmail,
      creatorName: promptData.creatorName,
      status: 'pending', 
      createdAt: new Date()
    };

    const result = await promptsCollection.insertOne(newPrompt);
    res.send(result);
  } catch (error) {
    res.status(500).send({ message: "Failed to add prompt", error: error.message });
  }
});

// ---- Get Specific User's Prompts API ----
app.get('/my-prompts', async (req, res) => {
  try {
    if (!promptsCollection) {
      return res.status(500).send({ message: "Database not ready yet" });
    }

    const email = req.query.email;
    if (!email) {
      return res.status(400).send({ message: "Email parameter is required" });
    }
    const query = { creatorEmail: email };
    const result = await promptsCollection.find(query).sort({ _id: -1 }).toArray();
    res.send(result || []);
  } catch (error) {
    res.status(500).send({ message: "Error fetching user prompts", error: error.message });
  }
});

// ---- Delete a Prompt API ----
app.delete('/prompt/:id', async (req, res) => {
  try {
    if (!promptsCollection) {
      return res.status(500).send({ message: "Database not ready yet" });
    }
    const id = req.params.id;
    const query = { _id: new ObjectId(id) };
    const result = await promptsCollection.deleteOne(query);
    res.send(result);
  } catch (error) {
    res.status(500).send({ message: "Failed to delete prompt", error: error.message });
  }
});

// ---- Update/Edit a Prompt API ----
app.put('/prompt/:id', async (req, res) => {
  try {
    if (!promptsCollection) {
      return res.status(500).send({ message: "Database not ready yet" });
    }
    const id = req.params.id;
    const filter = { _id: new ObjectId(id) };
    const updatedData = req.body;
    
    const updateDoc = {
      $set: {
        title: updatedData.title,
        description: updatedData.description,
        category: updatedData.category,
        aiTool: updatedData.aiTool,
        priceType: updatedData.priceType,
        price: updatedData.priceType === 'Free' ? 0 : parseFloat(updatedData.price) || 0,
        visibility: updatedData.visibility,
        status: 'pending' // এডিট করার পর স্ট্যাটাস আবার pending-এ যাবে
      },
    };

    const result = await promptsCollection.updateOne(filter, updateDoc);
    res.send(result);
  } catch (error) {
    res.status(500).send({ message: "Failed to update prompt", error: error.message });
  }
});

app.get('/', (req, res) => {
  res.send('AI Prompt Marketplace Server is Running...');
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
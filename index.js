const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken'); 
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb'); 

const app = express();
const port = process.env.PORT || 5000;

// Middleware কনফিগারেশন (Vercel ও CORS ফ্রেন্ডলি)
app.use(cors({
  origin: [
    'http://localhost:3000',
  ],
  credentials: true
}));
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

let usersCollection, promptsCollection, bookmarksCollection, reviewsCollection, reportsCollection;

async function run() {
  try {
    await client.connect();
    
    const db = client.db("aiPromptDB");
    usersCollection = db.collection("users");
    promptsCollection = db.collection("prompts"); 
    bookmarksCollection = db.collection("bookmarks");
    reviewsCollection = db.collection("reviews");
    reportsCollection = db.collection("reports");

    console.log("Successfully connected to MongoDB via PromptForge Engine!");
  } catch (err) {
    console.error("MongoDB Connection Error: ", err);
  }
}
run().catch(console.dir);

// =========================================================================
// 🔒 AUTHENTICATION & ROLE-BASED ACCESS CONTROL MIDDLEWARES
// =========================================================================

const verifyToken = (req, res, next) => {
  if (!req.headers.authorization) {
    return res.status(401).send({ message: 'Unauthorized access' });
  }
  const token = req.headers.authorization.split(' ')[1];
  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).send({ message: 'Unauthorized access' });
    }
    req.decoded = decoded;
    next();
  });
};

// =========================================================================
// 🔑 AUTHENTICATION & USER APIs
// =========================================================================

app.post('/jwt', async (req, res) => {
  try {
    const user = req.body; 
    if (!user || !user.email) return res.status(400).send({ message: "Valid user data is required" });
    const token = jwt.sign(user, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.send({ token });
  } catch (error) {
    res.status(500).send({ message: "JWT Generation Failed", error: error.message });
  }
});

app.post('/users', async (req, res) => {
  try {
    const user = req.body;
    if (!user || !user.email) return res.status(400).send({ message: "Email is required" });
    
    const query = { email: user.email };
    const existingUser = await usersCollection.findOne(query);
    if (existingUser) return res.send({ message: 'User already exists', insertedId: null });

    const newUser = {
      name: user.name || "Anonymous Forge User",
      email: user.email,
      photoURL: user.photoURL || "",
      role: 'User',        
      status: 'Free',      
      tier: 'Standard',    
      createdAt: new Date()
    };

    const result = await usersCollection.insertOne(newUser);
    res.send(result);
  } catch (error) {
    res.status(500).send({ message: "Internal Server Error in /users", error: error.message });
  }
});

app.get('/users/role/:email', verifyToken, async (req, res) => {
  try {
    const email = req.params.email;
    if (email !== req.decoded.email) return res.status(403).send({ message: 'Forbidden access' });
    const query = { email: email };
    const user = await usersCollection.findOne(query);
    res.send({ role: user?.role || 'User' });
  } catch (error) {
    res.status(500).send({ message: "Error fetching user role", error: error.message });
  }
});

// =========================================================================
// 📝 CORE MARKETPLACE & PROMPTS APIs
// =========================================================================

app.get('/featured-prompts', async (req, res) => {
  try {
    const featured = await promptsCollection.find({ status: "approved", visibility: "Public" })
      .sort({ _id: -1 }).limit(6).toArray();
    res.send(featured || []);
  } catch (error) {
    res.status(500).send({ message: "Error", error: error.message });
  }
});

app.get('/all-prompts', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 6; 
    const skip = (page - 1) * limit;

    const search = req.query.search || '';
    const category = req.query.category || '';
    const aiTool = req.query.aiTool || '';
    const sort = req.query.sort || '';

    let query = { status: "approved", visibility: "Public" };
    const conditions = [];

    if (search) {
      conditions.push({
        $or: [
          { title: { $regex: search, $options: 'i' } },
          { description: { $regex: search, $options: 'i' } }
        ]
      });
    }

    if (category) conditions.push({ category });
    if (aiTool) conditions.push({ aiTool });
    if (conditions.length > 0) query.$and = conditions;

    let sortOptions = {};
    if (sort === 'newest') sortOptions = { _id: -1 };
    else if (sort === 'price-low') sortOptions = { price: 1 };
    else if (sort === 'price-high') sortOptions = { price: -1 };
    else sortOptions = { _id: -1 };

    const prompts = await promptsCollection.find(query).sort(sortOptions).skip(skip).limit(limit).toArray();
    const totalCount = await promptsCollection.countDocuments(query) || 0;

    res.send({ prompts, totalCount, totalPages: Math.ceil(totalCount / limit), currentPage: page });
  } catch (error) {
    res.status(500).send({ message: "Error fetching prompts", error: error.message });
  }
});

// =========================================================================
// 🚀 DYNAMIC INTERACTION & PREMIUM ACCESS CONTROL APIs (আপডেটেড ও কমপ্লিট)
// =========================================================================

app.get('/prompt/:id', verifyToken, async (req, res) => {
  try {
    const id = req.params.id;
    const userEmail = req.query.email; 
    
    if (!ObjectId.isValid(id)) return res.status(400).send({ message: "Invalid ID specification" });

    const prompt = await promptsCollection.findOne({ _id: new ObjectId(id) });
    if (!prompt) return res.status(404).send({ message: "Prompt core untraceable" });

    const user = await usersCollection.findOne({ email: userEmail });
    const isPremiumUser = user?.status === 'Premium' || user?.role === 'Admin';

    const isBookmarked = await bookmarksCollection.findOne({ promptId: id, userEmail }) ? true : false;
    const reviews = await reviewsCollection.find({ promptId: id }).sort({ createdAt: -1 }).toArray();

    res.send({ prompt, isPremiumUser, isBookmarked, reviews });
  } catch (error) {
    res.status(500).send({ message: "Data extraction error", error: error.message });
  }
});

app.post('/prompt/bookmark', verifyToken, async (req, res) => {
  try {
    const { promptId, userEmail } = req.body;
    if (req.decoded.email !== userEmail) return res.status(403).send({ message: "Access forbidden" });

    const existingBookmark = await bookmarksCollection.findOne({ promptId, userEmail });

    if (existingBookmark) {
      await bookmarksCollection.deleteOne({ promptId, userEmail });
      return res.send({ action: 'removed', message: 'Bookmark successfully de-indexed.' });
    } else {
      await bookmarksCollection.insertOne({ promptId, userEmail, createdAt: new Date() });
      return res.send({ action: 'added', message: 'Prompt securely bookmarked.' });
    }
  } catch (error) {
    res.status(500).send({ message: "Bookmark pipeline failure", error: error.message });
  }
});

app.patch('/prompt/copy-count/:id', verifyToken, async (req, res) => {
  try {
    const id = req.params.id;
    const result = await promptsCollection.updateOne(
      { _id: new ObjectId(id) },
      { $inc: { copyCount: 1 } }
    );
    res.send(result);
  } catch (error) {
    res.status(500).send({ message: "Counter execution failed", error: error.message });
  }
});

app.post('/prompt/review', verifyToken, async (req, res) => {
  try {
    const { promptId, name, email, rating, comment } = req.body;
    if (req.decoded.email !== email) return res.status(403).send({ message: "Access forbidden" });

    const newReview = {
      promptId, name, email,
      rating: parseInt(rating),
      comment, createdAt: new Date()
    };

    await reviewsCollection.insertOne(newReview);
    res.send({ success: true });
  } catch (error) {
    res.status(500).send({ message: "Review logging aborted" });
  }
});

app.post('/prompt/report', verifyToken, async (req, res) => {
  try {
    const { promptId, userEmail, reason, description } = req.body;
    if (req.decoded.email !== userEmail) return res.status(403).send({ message: "Access forbidden" });

    const reportPayload = {
      promptId, userEmail, reason,
      description: description || "No elaboration provided",
      createdAt: new Date()
    };

    await reportsCollection.insertOne(reportPayload);
    res.send({ success: true });
  } catch (error) {
    res.status(500).send({ message: "Incident reports indexing failed" });
  }
});

app.get('/', (req, res) => {
  res.send('PromptForge Engine Backend Server is Running...');
});

app.listen(port, () => {
  console.log(`Server running safely on port ${port}`);
});
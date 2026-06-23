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
    // আপনার ফ্রন্টএন্ড Vercel-এ ডিপ্লয় করার পর সেই লাইভ লিংকটি এখানে কমা দিয়ে যুক্ত করবেন
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

let usersCollection;
let promptsCollection;

async function run() {
  try {
    // Vercel বা সার্ভারলেস এনভায়রনমেন্টের জন্য কানেকশন অপ্টিমাইজেশন
    await client.connect();
    
    const db = client.db("aiPromptDB");
    usersCollection = db.collection("users");
    promptsCollection = db.collection("prompts"); 

    console.log("Successfully connected to MongoDB via PromptForge Engine!");
  } catch (err) {
    console.error("MongoDB Connection Error: ", err);
  }
}
run().catch(console.dir);

// =========================================================================
// 🔒 AUTHENTICATION & ROLE-BASED ACCESS CONTROL MIDDLEWARES
// =========================================================================

// ১. JWT টোকেন ভেরিফিকেশন মিডলওয়্যার
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

// ২. অ্যাডমিন ভেরিফিকেশন মিডলওয়্যার (try-catch সহ সুরক্ষিত)
const verifyAdmin = async (req, res, next) => {
  try {
    const email = req.decoded?.email;
    if (!email) {
      return res.status(403).send({ message: 'Forbidden access' });
    }
    const query = { email: email };
    const user = await usersCollection.findOne(query);
    const isAdmin = user?.role === 'Admin';
    if (!isAdmin) {
      return res.status(403).send({ message: 'Forbidden access' });
    }
    next();
  } catch (error) {
    res.status(500).send({ message: "Internal Middleware Error" });
  }
};

// ৩. ক্রিয়েটর ভেরিফিকেশন মিডলওয়্যার
const verifyCreator = async (req, res, next) => {
  try {
    const email = req.decoded?.email;
    if (!email) {
      return res.status(403).send({ message: 'Forbidden access' });
    }
    const query = { email: email };
    const user = await usersCollection.findOne(query);
    const isCreator = user?.role === 'Creator' || user?.role === 'Admin';
    if (!isCreator) {
      return res.status(403).send({ message: 'Forbidden access' });
    }
    next();
  } catch (error) {
    res.status(500).send({ message: "Internal Middleware Error" });
  }
};

// =========================================================================
// 🔑 AUTHENTICATION & USER APIs
// =========================================================================

// JWT টোকেন জেনারেট করা
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

// ইউজার সেভ করা (ইউনিক স্কিমা ভ্যালুসহ ও প্লেজারিজম ফ্রী ডিফল্ট রোল 'User')
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
      return res.send({ message: 'User already exists', insertedId: null });
    }

    const newUser = {
      name: user.name || "Anonymous Forge User",
      email: user.email,
      photoURL: user.photoURL || "",
      role: 'User',        // রিকোয়ারমেন্ট অনুযায়ী ডিফল্ট রোল 'User' 
      status: 'Free',      // ডিফল্ট সাবস্ক্রিপশন স্ট্যাটাস
      tier: 'Standard',    // ডেমো থেকে ইউনিক আইডেন্টিটি তৈরি করার এক্সট্রা ফিল্ড
      createdAt: new Date()
    };

    const result = await usersCollection.insertOne(newUser);
    res.send(result);
  } catch (error) {
    res.status(500).send({ message: "Internal Server Error in /users", error: error.message });
  }
});

// ইউজারের রোল চেক করার এপিআই
app.get('/users/role/:email', verifyToken, async (req, res) => {
  try {
    const email = req.params.email;
    if (email !== req.decoded.email) {
      return res.status(403).send({ message: 'Forbidden access' });
    }
    const query = { email: email };
    const user = await usersCollection.findOne(query);
    res.send({ role: user?.role || 'User' });
  } catch (error) {
    res.status(500).send({ message: "Error fetching user role", error: error.message });
  }
});

// =========================================================================
// 📝 PROMPTS APIs
// =========================================================================

// হোম পেজের জন্য ফিচার্ড প্রম্পট এপিআই (সর্বোচ্চ ৬টি অনুমোদিত পাবলিক প্রম্পট)
app.get('/featured-prompts', async (req, res) => {
  try {
    if (!promptsCollection) {
      return res.status(500).send({ message: "Database not ready yet" });
    }
    const query = { status: "approved", visibility: "Public" };
    const featured = await promptsCollection.find(query)
      .sort({ _id: -1 }) 
      .limit(6)          
      .toArray();
    res.send(featured || []);
  } catch (error) {
    res.status(500).send({ message: "Error fetching featured prompts", error: error.message });
  }
});

// সব প্রম্পট এপিআই (সার্চ, ফিল্টার, সর্ট, এবং পেজিনেশন)
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
    const conditions = [];

    if (search) {
      conditions.push({
        $or: [
          { title: { $regex: search, $options: 'i' } },
          { description: { $regex: search, $options: 'i' } }
        ]
      });
    }

    if (category) { conditions.push({ category: category }); }
    if (aiTool) { conditions.push({ aiTool: aiTool }); }
    if (conditions.length > 0) { query.$and = conditions; }

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

// একক প্রম্পটের ডিটেইলস (প্রাইভেট রুট)
app.get('/prompt/:id', verifyToken, async (req, res) => {
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

// নতুন প্রম্পট যোগ করা (স্ট্যাটাস ডিফল্ট 'pending' থাকবে)
app.post('/add-prompt', verifyToken, async (req, res) => {
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

// নির্দিষ্ট ইউজারের নিজের তৈরি প্রম্পট
app.get('/my-prompts', verifyToken, async (req, res) => {
  try {
    if (!promptsCollection) {
      return res.status(500).send({ message: "Database not ready yet" });
    }
    const email = req.query.email;
    if (!email) {
      return res.status(400).send({ message: "Email parameter is required" });
    }
    if (email !== req.decoded.email) {
      return res.status(403).send({ message: "Forbidden access" });
    }
    const query = { creatorEmail: email };
    const result = await promptsCollection.find(query).sort({ _id: -1 }).toArray();
    res.send(result || []);
  } catch (error) {
    res.status(500).send({ message: "Error fetching user prompts", error: error.message });
  }
});

// প্রম্পট ডিলিট করা
app.delete('/prompt/:id', verifyToken, async (req, res) => {
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

// প্রম্পট আপডেট/এডিট করা
app.put('/prompt/:id', verifyToken, async (req, res) => {
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
        status: 'pending' 
      },
    };
    const result = await promptsCollection.updateOne(filter, updateDoc);
    res.send(result);
  } catch (error) {
    res.status(500).send({ message: "Failed to update prompt", error: error.message });
  }
});

// Base Route
app.get('/', (req, res) => {
  res.send('PromptForge Engine Middleware Server is Running...');
});

app.listen(port, () => {
  console.log(`Server is running securely on port ${port}`);
});
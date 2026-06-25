const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken'); 
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb'); 

// স্ট্রাইপ সিক্রেট কী ইনিশিয়ালাইজেশন
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();
const port = process.env.PORT || 5000;

// Middleware কনফিগারেশন (Vercel ও CORS ফ্রেন্ডলি)
app.use(cors({
  origin: [
    'http://localhost:3000',
  ],
  credentials: true
}));
// পুরোনো app.use(express.json()); এর পরিবর্তে এই দুটি লাইন বসিয়ে দিন
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// MongoDB Connection
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.d4nhymd.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

let usersCollection, promptsCollection, bookmarksCollection, reviewsCollection, reportsCollection, paymentsCollection;

async function run() {
  try {
    await client.connect();
    
    const db = client.db("aiPromptDB");
    usersCollection = db.collection("users");
    promptsCollection = db.collection("prompts"); 
    bookmarksCollection = db.collection("bookmarks");
    reviewsCollection = db.collection("reviews");
    reportsCollection = db.collection("reports");
    paymentsCollection = db.collection("payments"); // পেমেন্ট কালেকশন ইন্টিগ্রেশন

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
// 🌐 MARKETPLACE ADVANCED SERVER-SIDE FILTERING API
// =========================================================================

app.get('/marketplace-prompts', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 6; 
    const skip = (page - 1) * limit;

    const { search, category, aiTool, difficulty, sort } = req.query;

    // ডিফল্ট কুয়েরি: শুধুমাত্র এপ্রুভড এবং পাবলিক প্রম্পট দেখাবে
    let query = { status: "approved", visibility: "Public" };
    let conditions = [];

    // ১. টাইটেল এবং ট্যাগস এর উপর ভিত্তি করে কাস্টম সার্চ লজিক
    if (search) {
      conditions.push({
        $or: [
          { title: { $regex: search, $options: 'i' } },
          { tags: { $regex: search, $options: 'i' } },
          { aiTool: { $regex: search, $options: 'i' } }
        ]
      });
    }

    // ২. ফিল্টার কন্ডিশনস ইন্টিগ্রেশন
    if (category) conditions.push({ category: category });
    if (aiTool) conditions.push({ aiTool: aiTool });
    if (difficulty) conditions.push({ difficulty: difficulty });

    if (conditions.length > 0) {
      query.$and = conditions;
    }

    // ৩. সর্টিং অ্যালগরিদম কনফিগারেশন
    let sortOptions = {};
    if (sort === 'popular') {
      sortOptions = { rating: -1 }; // সর্বোচ্চ রেটিং অনুযায়ী
    } else if (sort === 'copied') {
      sortOptions = { copyCount: -1 }; // সর্বোচ্চ কপি অনুযায়ী
    } else {
      sortOptions = { _id: -1 }; // নতুন আপলোড ফাইল সবার আগে (Latest)
    }

    // ডাটাবেজ এক্সেকিউশন
    const prompts = await promptsCollection.find(query)
      .sort(sortOptions)
      .skip(skip)
      .limit(limit)
      .toArray();

    const totalCount = await promptsCollection.countDocuments(query) || 0;

    res.send({
      prompts,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
      currentPage: page
    });
  } catch (error) {
    res.status(500).send({ message: "Marketplace index system failure", error: error.message });
  }
});

// =========================================================================
// 🚀 DYNAMIC INTERACTION & PREMIUM ACCESS CONTROL APIs
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

// =========================================================================
// 💳 STRIPE PAYMENT APIs
// =========================================================================

// ১. পেমেন্ট ইনটেন্ট তৈরি করা (Client Secret জেনারেট করা)
app.post('/create-payment-intent', verifyToken, async (req, res) => {
  try {
    const { price } = req.body;
    if (!price || price !== 5) {
      return res.status(400).send({ message: "Invalid subscription amount node." });
    }

    // সেন্ট-এ কনভার্ট করা ($5 = 500 cents)
    const amount = parseInt(price * 100);

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amount,
      currency: 'usd',
      payment_method_types: ['card']
    });

    res.send({
      clientSecret: paymentIntent.client_secret
    });
  } catch (error) {
    res.status(500).send({ message: "Payment pipeline encryption failed", error: error.message });
  }
});

// ২. সফল পেমেন্ট লেজার এবং ইউজার স্ট্যাটাস আপডেট এপিআই
app.post('/payment-success', verifyToken, async (req, res) => {
  try {
    const paymentInfo = req.body;
    if (req.decoded.email !== paymentInfo.email) {
      return res.status(403).send({ message: "Forbidden access ledger breach." });
    }

    // ক) পেমেন্ট হিস্ট্রি ডাটাবেজে সেভ করা
    const paymentResult = await paymentsCollection.insertOne({
      transactionId: paymentInfo.transactionId,
      email: paymentInfo.email,
      amount: paymentInfo.amount,
      date: new Date(),
      status: 'success'
    });

    // খ) ইউজারের সাবস্ক্রিপশন স্ট্যাটাস 'Premium' এ রূপান্তর করা
    const userFilter = { email: paymentInfo.email };
    const updatedDoc = {
      $set: {
        status: 'Premium',
        tier: 'VIP Forge Architect'
      }
    };
    const userResult = await usersCollection.updateOne(userFilter, updatedDoc);

    res.send({ success: true, paymentResult, userResult });
  } catch (error) {
    res.status(500).send({ message: "Database update failed post-transaction", error: error.message });
  }
});

// =========================================================================
// 🎛️ USER DASHBOARD CORE APIs
// =========================================================================

// ১. নতুন প্রম্পট যোগ করা (ফ্রি ইউজার লিমিট ৩ চেক সহ)
app.post('/add-prompt', verifyToken, async (req, res) => {
  try {
    const promptData = req.body;
    if (req.decoded.email !== promptData.creatorEmail) {
      return res.status(403).send({ message: "Forbidden pipeline breach." });
    }

    // ইউজারের কারেন্ট স্ট্যাটাস চেক করা (Free নাকি Premium)
    const user = await usersCollection.findOne({ email: promptData.creatorEmail });
    
    if (user?.status !== 'Premium' && user?.role !== 'Admin') {
      // ফ্রি ইউজার হলে অলরেডি কয়টা প্রম্পট আপলোড করেছে তা চেক করা
      const uploadedCount = await promptsCollection.countDocuments({ creatorEmail: promptData.creatorEmail });
      if (uploadedCount >= 3) {
        return res.status(403).send({ 
          limitReached: true, 
          message: "Free tier threshold reached. Max 3 prompts allowed. Upgrade to Premium matrix." 
        });
      }
    }

    // প্রম্পট অবজেক্ট ডাটাবেজে ইনসার্ট করা
    const result = await promptsCollection.insertOne({
      ...promptData,
      copyCount: 0,
      status: 'pending', // অ্যাডমিন অ্যাপ্রুভালের জন্য ওয়েট করবে
      createdAt: new Date()
    });

    res.send(result);
  } catch (error) {
    res.status(500).send({ message: "Failed to deploy prompt construct", error: error.message });
  }
});

// ২. ড্যাশবোর্ডের প্রোফাইল অ্যানালিটিক্স ও সামারি ডেটা আনা
app.get('/user-summary/:email', verifyToken, async (req, res) => {
  try {
    const email = req.params.email;
    if (req.decoded.email !== email) return res.status(403).send({ message: "Forbidden" });

    const totalPrompts = await promptsCollection.countDocuments({ creatorEmail: email });
    res.send({ totalPrompts });
  } catch (error) {
    res.status(500).send({ message: "Error compiling sync logs" });
  }
});

// ৩. কারেন্ট ইউজারের তৈরি করা প্রম্পট লিস্ট (My Prompts)
app.get('/my-prompts/:email', verifyToken, async (req, res) => {
  try {
    const email = req.params.email;
    if (req.decoded.email !== email) return res.status(403).send({ message: "Forbidden" });

    const result = await promptsCollection.find({ creatorEmail: email }).sort({ _id: -1 }).toArray();
    res.send(result);
  } catch (error) {
    res.status(500).send({ message: "Error fetching user archive" });
  }
});

// ৪. প্রম্পট ডিলিট করা
app.delete('/prompt-delete/:id', verifyToken, async (req, res) => {
  try {
    const id = req.params.id;
    const result = await promptsCollection.deleteOne({ _id: new ObjectId(id) });
    res.send(result);
  } catch (error) {
    res.status(500).send({ message: "Deletion command aborted" });
  }
});

// ৫. ইউজারের সেভ করা/বুকমার্কড প্রম্পট লিস্ট
app.get('/my-bookmarks/:email', verifyToken, async (req, res) => {
  try {
    const email = req.params.email;
    if (req.decoded.email !== email) return res.status(403).send({ message: "Forbidden" });

    // প্রথমে বুকমার্ক টেবিল থেকে প্রম্পট আইডিগুলো নেওয়া
    const bookmarks = await bookmarksCollection.find({ userEmail: email }).toArray();
    const promptIds = bookmarks.map(b => new ObjectId(b.promptId));

    // আইডিগুলো দিয়ে মেইন প্রম্পট কালেকশন থেকে ডেটা খুঁজে বের করা
    const savedPrompts = await promptsCollection.find({ _id: { $in: promptIds } }).toArray();
    res.send(savedPrompts);
  } catch (error) {
    res.status(500).send({ message: "Error fetching saved terminal metrics" });
  }
});

// ৬. ইউজারের দেওয়া রিভিউ লিস্ট (My Reviews)
app.get('/my-reviews/:email', verifyToken, async (req, res) => {
  try {
    const email = req.params.email;
    if (req.decoded.email !== email) return res.status(403).send({ message: "Forbidden" });

    const result = await reviewsCollection.find({ email: email }).sort({ createdAt: -1 }).toArray();
    res.send(result);
  } catch (error) {
    res.status(500).send({ message: "Review log query failed" });
  }
});

// ==========================================
// REAL ADMIN DASHBOARD SUBSYSTEM ENDPOINTS
// ==========================================


// ===================================================
// 🔐 CHALLENGE MIDDLEWARES (JWT & ADMIN VERIFICATION)
// ===================================================

// ১. JWT ভেরিফাই মিডলওয়্যার
const verifyJWT = (req, res, next) => {
  const authorization = req.headers.authorization;
  if (!authorization) {
    return res.status(401).send({ error: true, message: 'Unauthorized Access Matrix' });
  }
  
  const token = authorization.split(' ')[1];
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).send({ error: true, message: 'Forbidden Access Matrix' });
    }
    req.decoded = decoded;
    next();
  });
};

// ২. অ্যাডমিন ভেরিফাই মিডলওয়্যার (ডাটাবেজ থেকে রোল চেক করবে)
const verifyAdmin = async (req, res, next) => {
  const email = req.decoded.email;
  const query = { email: email };
  const user = await usersCollection.findOne(query);
  if (user?.role !== 'admin') {
    return res.status(403).send({ error: true, message: 'Forbidden Command Level' });
  }
  next();
};

// ===================================================
// ⚡ JWT GENERATOR ROUTE (লগইনের সময় টোকেন ইস্যু করার জন্য)
// ===================================================
app.post('/jwt', async (req, res) => {
  const user = req.body;
  const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1h' });
  res.send({ token });
});

// ===================================================
// 🛡️ COMBINED SECURE ADMIN SUB-SYSTEM (100% REAL DATA)
// ===================================================

// ==========================================
// 📊 ADMIN API ROUTES (No Duplicate Middlewares)
// ==========================================

// ১. অ্যানালিটিক্স ডাটা জেনারেশন
app.get('/admin/analytics', verifyJWT, verifyAdmin, async (req, res) => {
  try {
    const totalUsers = await usersCollection.countDocuments();
    const totalPrompts = await promptsCollection.countDocuments();
    const totalReviews = await reviewsCollection.countDocuments();

    const copyResult = await promptsCollection.aggregate([
      {
        $group: {
          _id: null,
          totalCopies: { $sum: { $ifNull: ["$copyCount", 0] } }
        }
      }
    ]).toArray();

    const totalCopies = copyResult[0]?.totalCopies || 0;

    res.send({ totalUsers, totalPrompts, totalReviews, totalCopies });
  } catch (error) {
    res.status(500).send({ message: "Analytics generation failed", error });
  }
});

// ২. অল ইউজার লিস্ট (With Backend Pagination)
app.get('/admin/users', verifyJWT, verifyAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const size = parseInt(req.query.size) || 5;
    const skip = (page - 1) * size;

    const result = await usersCollection.find().skip(skip).limit(size).toArray();
    const total = await usersCollection.countDocuments();

    res.send({ result, total });
  } catch (error) {
    res.status(500).send({ message: "Failed to fetch users" });
  }
});

// ৩. ইউজারের রোল পরিবর্তন (PATCH Action - Secure)
app.patch('/admin/user-role/:id', verifyJWT, verifyAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    const { role } = req.body;
    const filter = { _id: new ObjectId(id) };
    const updatedDoc = { $set: { role: role } };
    const result = await usersCollection.updateOne(filter, updatedDoc);
    res.send(result);
  } catch (error) {
    res.status(500).send({ message: "Failed to change role" });
  }
});

// ৪. ইউজার ডিলিট করা (DELETE Action - Secure)
app.delete('/admin/user-delete/:id', verifyJWT, verifyAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    const query = { _id: new ObjectId(id) };
    const result = await usersCollection.deleteOne(query);
    res.send(result);
  } catch (error) {
    res.status(500).send({ message: "Failed to delete user" });
  }
});

// ৫. অল প্রম্পটস লিস্ট (With Backend Search, Filter, Sort & Pagination)
app.get('/admin/prompts', verifyJWT, verifyAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const size = parseInt(req.query.size) || 5;
    const skip = (page - 1) * size;

    const search = req.query.search || '';
    const statusFilter = req.query.status || '';
    const sortOrder = req.query.sort === 'asc' ? 1 : -1;

    let query = {
      title: { $regex: search, $options: 'i' }
    };

    if (statusFilter) {
      query.status = statusFilter;
    }

    const result = await promptsCollection.find(query)
      .sort({ createdAt: sortOrder })
      .skip(skip)
      .limit(size)
      .toArray();

    const total = await promptsCollection.countDocuments(query);

    res.send({ result, total });
  } catch (error) {
    res.status(500).send({ message: "Failed to fetch prompts" });
  }
});

// ৬. প্রম্পট স্ট্যাটাস আপডেট - Approved/Rejected (PATCH Action - Secure)
app.patch('/admin/prompt-status/:id', verifyJWT, verifyAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    const { status, feedback } = req.body;
    const filter = { _id: new ObjectId(id) };
    const updatedDoc = {
      $set: { 
        status: status,
        feedback: feedback || "" 
      }
    };
    const result = await promptsCollection.updateOne(filter, updatedDoc);
    res.send(result);
  } catch (error) {
    res.status(500).send({ message: "Failed to update prompt status" });
  }
});

// ७. প্রম্পট ডিলিট করা (DELETE Action - Secure)
app.delete('/admin/prompt-delete/:id', verifyJWT, verifyAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    const { reportId } = req.query;
    
    const promptQuery = { _id: new ObjectId(id) };
    const result = await promptsCollection.deleteOne(promptQuery);

    if (reportId) {
      await reportsCollection.deleteOne({ _id: new ObjectId(reportId) });
    }

    res.send(result);
  } catch (error) {
    res.status(500).send({ message: "Failed to delete prompt" });
  }
});

// ৮. অল পেমেন্টস হিস্ট্রি (With Backend Pagination - Secure)
app.get('/admin/payments', verifyJWT, verifyAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const size = parseInt(req.query.size) || 5;
    const skip = (page - 1) * size;

    const result = await paymentsCollection.find().skip(skip).limit(size).toArray();
    const total = await paymentsCollection.countDocuments();

    res.send({ result, total });
  } catch (error) {
    res.status(500).send({ message: "Failed to fetch payments" });
  }
});

// ৯. অল রিপোর্টেড প্রম্পটস (With Backend Pagination - Secure)
app.get('/admin/reported-prompts', verifyJWT, verifyAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const size = parseInt(req.query.size) || 5;
    const skip = (page - 1) * size;

    const result = await reportsCollection.find().skip(skip).limit(size).toArray();
    const total = await reportsCollection.countDocuments();

    res.send({ result, total });
  } catch (error) {
    res.status(500).send({ message: "Failed to fetch reports" });
  }
});

// ১০. রিপোর্ট ডিসমিস/বাতিল করা (PATCH/DELETE Action - Secure)
app.patch('/admin/report-dismiss/:id', verifyJWT, verifyAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    const query = { _id: new ObjectId(id) };
    const result = await reportsCollection.deleteOne(query);
    res.send(result);
  } catch (error) {
    res.status(500).send({ message: "Failed to dismiss report" });
  }
});

// ১১. ক্রিয়েটরকে ওয়ার্নিং পাঠানো (Secure)
app.post('/admin/warn-creator', verifyJWT, verifyAdmin, async (req, res) => {
  try {
    const { email, message, reportId } = req.body;
    
    const notificationDoc = {
      type: "Warning",
      recipientEmail: email,
      message: message,
      createdAt: new Date(),
      read: false
    };
    
    const result = await db.collection('notifications').insertOne(notificationDoc);

    if (reportId) {
      await reportsCollection.deleteOne({ _id: new ObjectId(reportId) });
    }

    res.send(result);
  } catch (error) {
    res.status(500).send({ message: "Failed to transmit warning" });
  }
});

// =========================================================================
// 🌐 BASE & LISTENER CONNECTIONS
// =========================================================================

app.get('/', (req, res) => {
  res.send('PromptForge Engine Backend Server is Running...');
});

app.listen(port, () => {
  console.log(`Server running safely on port ${port}`);
});
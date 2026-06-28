# 🎛️ PromptForge Engine – Serverless Backend Infrastructure

This repository houses the core backend engine powering the PromptForge ecosystem. Built as a high-performance, stateless RESTful API, it manages secure MongoDB transactions, implements structural security parameters, and enforces premium gateway business metrics.

---

## 🛠️ Comprehensive Backend Stack & Utility Analysis

The architecture is carefully constructed using Node.js and Express to comply with modern serverless environment paradigms (like Vercel Serverless Functions).

### 1. Routing Engine & Server Framework
* **Node.js & Express.js:** The core foundational framework chosen for its lightweight footprint, unopinionated routing design, and exceptional asynchronous handling capabilities via event-driven execution loops.
* **CORS (Cross-Origin Resource Sharing):** Configured with restrictive origin parameters to exclusively accept requests coming from localhost development ports and your authenticated Vercel live production domain (`ai-prompt-client-woad.vercel.app`), mitigating Cross-Site Scripting (XSS) injection vectors.

### 2. Distributed Database Management
* **MongoDB Native Driver (MongoClient):** Direct aggregation-layer communication avoiding the overhead of heavy object-document mapping (ODM) systems. 
* **Serverless Database Middlewares:** Contains a dynamic runtime verification middleware that checks for active connection topologies (`client.topology.isConnected()`) on every single API entry point. This solves the infamous serverless database cold-start timeout glitch.

### 3. Cryptographic Security & Authorizations
* **jsonwebtoken (JWT):** The security foundation of the backend. Enforces stateless, signed identity states. Protected endpoints filter incoming payloads through custom token verifiers before proceeding with CRUD operations.
* **dotenv:** Safeguards underlying server variables (`DB_USER`, `DB_PASS`, `STRIPE_SECRET_KEY`) preventing raw credential leaks into repository logs.

### 4. Advanced Transaction Gateways
* **Stripe SDK (Node Core):** Handles payment intents directly on the backend server. It takes a raw dollar calculation, processes cryptographically sound cent values, encrypts transaction schemas, and feeds feedback loops directly into the database user parameters.

---

## 📡 Production API Blueprint & Access Protocols

### 🔑 Authentication Matrix
* `POST /jwt` -> Signs and issues authorization web tokens to incoming authenticated client entities.

### 📑 Public Resource Index
* `GET /all-prompts` -> Employs MongoDB query parsing for server-side pagination, text-index regex matching, and ascending/descending sorting controls.
* `GET /featured-prompts` -> Pulls down targeted collections based on status flags.

### 🛡️ Secure Admin Commands (`verifyToken` + `verifyAdmin` Enforced)
* `GET /admin/analytics` -> Utilizes complex MongoDB Aggregation Frameworks (`$group`, `$sum`, `$ifNull`) to merge total site telemetry data into single dashboard analytical datasets.
* `PATCH /admin/user-role/:id` -> Updates specific database user flags safely using MongoDB `ObjectId` mapping.

---

## ⚙️ Local Infrastructure Setup

1.  **Clone the Repository:**
    ```bash
    git clone [https://github.com/YOUR_GITHUB_USERNAME/YOUR_SERVER_REPO.git](https://github.com/YOUR_GITHUB_USERNAME/YOUR_SERVER_REPO.git)
    cd YOUR_SERVER_REPO
    ```

2.  **Install Production Libraries:**
    ```bash
    npm install
    ```

3.  **Environment Variable Configurations:**
    Create a secure `.env` file in the root root folder and provide your database and transaction credentials:
    ```env
    DB_USER=your_mongodb_username
    DB_PASS=your_mongodb_password
    JWT_SECRET=your_jwt_private_hash_string
    STRIPE_SECRET_KEY=your_stripe_secret_restricted_key
    ```

4.  **Execute Server Runtime Engine:**
    ```bash
    npm start
    ```

---

## 🛡️ License Architecture
Distributed under the open-source MIT License guidelines.
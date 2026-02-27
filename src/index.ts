import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { identifyContact } from './identityService';

dotenv.config();

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/', (req: Request, res: Response) => {
  res.json({ 
    message: 'Bitespeed Identity Reconciliation Service',
    status: 'running',
    endpoints: {
      identify: 'POST /identify'
    }
  });
});

// Main identify endpoint
app.post('/identify', async (req: Request, res: Response) => {
  try {
    const { email, phoneNumber } = req.body;

    // Validation
    if (!email && !phoneNumber) {
      return res.status(400).json({ 
        error: 'At least one of email or phoneNumber must be provided' 
      });
    }

    const result = await identifyContact(email, phoneNumber);
    
    res.status(200).json(result);
  } catch (error) {
    console.error('Error in /identify:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  await prisma.$disconnect();
  process.exit();
});
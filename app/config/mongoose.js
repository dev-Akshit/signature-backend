import dotenv from 'dotenv';
import mongoose from 'mongoose';

dotenv.config();
mongoose.connect(process.env.MONGO_CONNECTION_STRING)
export default mongoose;
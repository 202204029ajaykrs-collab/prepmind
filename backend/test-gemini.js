// Test script for Gemini API integration
require("dotenv").config();
const { GoogleGenerativeAI } = require("@google/generative-ai");

async function testGeminiAPI() {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    
    if (!apiKey || apiKey === "your_gemini_api_key_here") {
      console.log("❌ Please update your GEMINI_API_KEY in the .env file");
      console.log("1. Get your API key from: https://makersuite.google.com/app/apikey");
      console.log("2. Replace 'your_gemini_api_key_here' in backend/.env with your actual API key");
      return;
    }

    console.log("Testing Gemini API with key:", apiKey.substring(0, 10) + "...");
    
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    
    const result = await model.generateContent("Hello, this is a test message. Please respond with 'API working correctly'.");
    const response = result.response.text();
    
    console.log("✅ Gemini API working correctly!");
    console.log("Response:", response);
    
  } catch (error) {
    console.log("❌ Gemini API error:", error.message);
    if (error.message.includes("API key not valid")) {
      console.log("Please check your API key in the .env file");
    }
  }
}

testGeminiAPI();


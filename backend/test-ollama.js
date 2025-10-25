// Test script for Ollama Phi-3 integration
require("dotenv").config();
const { Ollama } = require("ollama");

async function testOllamaAPI() {
  try {
    console.log("Testing Ollama with Phi-3 model...");
    
    // Create Ollama client
    const ollama = new Ollama({ host: 'http://127.0.0.1:11434' });
    
    // Test simple generation with Phi-3
    const response = await ollama.chat({
      model: "phi3",
      messages: [{ role: 'user', content: "Hello, this is a test message. Please respond with 'Ollama Phi-3 working correctly'." }]
    });
    
    console.log("✅ Ollama Phi-3 working correctly!");
    console.log("Response:", response.message.content);
    
  } catch (error) {
    console.log("❌ Ollama error:", error.message);
    console.log("Please make sure Ollama is running and the Phi-3 model is installed.");
    console.log("You can install the model with: ollama pull phi3");
  }
}

testOllamaAPI();
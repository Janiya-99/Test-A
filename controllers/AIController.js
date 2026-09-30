const { GoogleGenerativeAI } = require("@google/generative-ai");
require("dotenv").config();
const { fetchRuleDetails } = require("../services/branchDBService");

const getGenAIInstance = async (branchId) => {
  let apiKey = null;
  if (branchId) {
    try {
      const rules = await fetchRuleDetails(branchId);
      if (rules && rules.length > 0 && rules[0].gemini_api_key) {
        apiKey = rules[0].gemini_api_key;
        console.log(`[AIController] Using branch-specific API key for branch ${branchId}`);
      }
    } catch (e) {
      console.error("[AIController] Error fetching branch API key:", e);
    }
  }

  if (!apiKey || apiKey === "YOUR_NEW_KEY_HERE" || apiKey.includes("YOUR_")) {
    throw new Error("API_KEY_NOT_CONFIGURED");
  }


  return new GoogleGenerativeAI(apiKey);
};

const generateDetails = async (req, res, type) => {
  console.log(`--------------- AI CONTROLLER HIT (${type}) ---------------`);
  console.log("Request Body:", req.body);
  try {
    const { prompt, branchId } = req.body;

    if (!prompt) {
      return res
        .status(400)
        .json({ success: false, message: "Prompt is required" });
    }

    let genAI;
    try {
      genAI = await getGenAIInstance(branchId);
    } catch (apiErr) {
      if (apiErr.message === "API_KEY_NOT_CONFIGURED") {
        return res.status(400).json({
          success: false,
          code: "API_KEY_NOT_CONFIGURED",
          message: "Please configure your Gemini API Key in System Settings first.",
        });
      }
      throw apiErr;
    }

    const modelName = process.env.GEMINI_MODEL || "gemini-2.0-flash";
    console.log("Using Model:", modelName);
    const model = genAI.getGenerativeModel({ model: modelName });


    let systemPrompt = "";

    if (type === "supplier") {
      systemPrompt = `
        You are an AI assistant helping to fill out a supplier form.
        Extract the following details from the user's input:
        - Company_Name
        - Agent_Name
        - Contact_No (Telephone 01)
        - Contact_No2 (Telephone 02)
        - Email
        - Address1
        - Address2
        - Address3

        If a field is not mentioned, return it as Default. It is a must the Contact_No (Telephone 01),
        Contact_No2 (Telephone 02) to be 10 digit numbers. So for default values use 0787564524. 
        Email should also be default@gmail.com for default values. However if the user mentions it should get those details. 
        Return strictly a valid JSON object. Do not include markdown code blocks (e.g. \`\`\`json).
        
        Example Input: "Create a supplier for Tech Solutions. The agent is John Doe, email john@tech.com, phone 0000000000."
        Example Output: {
          "Company_Name": "Tech Solutions",
          "Agent_Name": "John Doe",
          "Contact_No": "0000000000",
          "Contact_No2": "0000000000",
          "Email": "john@tech.com",
          "Address1": "",
          "Address2": "",
          "Address3": ""
        }
      `;
    } else if (type === "customer") {
      systemPrompt = `
        You are an AI assistant helping to fill out a customer form.
        Extract details from the user's input. If a specific detail is NOT provided, use the STRICT default values listed below.
        
        Output JSON Structure & Defaults:
        {
          "customerType": "Individual" (or "Company" if implied),
          "title": "Mr",
          "firstName": "Default",
          "middleName": "",
          "lastName": "",
          "displayName": "",
          "companyName": "",
          "companyEmail": "default@gmail.com",
          "phoneNumber": "0000000000",
          "mobileNumber": "0000000000",
          "fax": "",
          "other": "",
          "website": "",
          "gstNo": "",
          "vatNo": "",
          "billingAddress1": "",
          "billingAddress2": "",
          "billingAddress3": "",
          "billingCity": "",
          "billingProvince": "",
          "billingCountry": "",
          "shippingAddress1":"",
          "shippingAddress2": "",
          "shippingAddress3": "",
          "shippingCity": "",
          "shippingProvince": "",
          "shippingPostalCode": "",
          "shippingCountry": "",
          "officialEmail": "",
          "officialPhone": ""
        }
        
        Rules:
        1. "firstName", "phoneNumber", and "companyEmail" are MANDATORY. Use details from prompt, otherwise use defaults ("Default", "0000000000", "default@gmail.com").
        2. "phoneNumber" and "mobileNumber" MUST be 10 digits. If the user provides a number, format it. If not, use "0000000000".
        3. If it's a company, set "firstName" to the Company Name or "Company User" if not clear.
        
        Return strictly a valid JSON object.
      `;
    } else if (type === "product") {
      systemPrompt = `
        You are an AI assistant helping to fill out a product form.
        Extract details from the user's input. If a specific detail is NOT provided, use the STRICT default values.
        
        Output JSON Structure & Defaults:
        {
          "Type": "1", // 1=Item, 2=Service. Default to 1 (Item) unless "service" is mentioned.
          "Description": "Default Product", // Product Name
          "Cost": "0",
          "Rate": "0", // Selling Price
          "Qty_Type": "No. Of Items", // Default. Valid values: Kilogram(kg), Gram(g), Liter(l), No. Of Items, etc.
          "Opening_Qty": "0", // Default to 0
          "Item_Has_Serial": 0, // 0=No, 1=Yes. Default 0.
          "Expired_Date": 0, // 0=No, 1=Yes. Default 0.
          "Category_Name": "", // Mandatory. If not provided, infer from description or use "General".
          "low_stock_level": "0"
        }
        
        Rules:
        1. "Description" (Name) is MANDATORY. Extract from prompt.
        2. "Cost" and "Rate" (Price) should be numbers. Default to 0.
        3. "Qty_Type" should match standard units if possible, otherwise "No. Of Items".
        4. "Category_Name" is MANDATORY.
        5. "Opening_Qty" should be extracted if mentioned.
        
        Return strictly a valid JSON object.
      `;
    }

    const result = await model.generateContent([
      systemPrompt,
      `User Input: ${prompt}`,
    ]);
    const response = await result.response;
    let text = response.text();

    // Clean up markdown if present
    text = text
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    const data = JSON.parse(text);

    res.json({ success: true, data });
  } catch (error) {
    console.error(`Error generating ${type} details:`, error);

    // Handle specific status codes if available in error object
    const status = error.status || 500;
    const message =
      error.status === 429
        ? "Rate limit exceeded. Please wait a moment and try again."
        : "Failed to generate details";

    res.status(status).json({
      success: false,
      message: message,
      error: error.message,
    });
  }
};

const generateProductDescription = async (req, res) => {
  console.log("--------------- AI CONTROLLER HIT (product-description) ---------------");
  try {
    const { prompt, branchId } = req.body;
    if (!prompt) {
      return res.status(400).json({ success: false, message: "Prompt is required" });
    }

    let genAI;
    try {
      genAI = await getGenAIInstance(branchId);
    } catch (apiErr) {
      if (apiErr.message === "API_KEY_NOT_CONFIGURED") {
        return res.status(400).json({
          success: false,
          code: "API_KEY_NOT_CONFIGURED",
          message: "Please configure your Gemini API Key in System Settings first.",
        });
      }
      throw apiErr;
    }

    const modelName = process.env.GEMINI_MODEL || "gemini-2.0-flash";
    const model = genAI.getGenerativeModel({ model: modelName });


    const systemPrompt = `
      You are a professional product/service description copywriter for a business management system.
      The user will describe a product or service in plain language — this may be in English or Sinhala (සිංහල), including voice-transcribed Sinhala text.

      Your job is to generate a rich, professional, well-structured description in HTML format.

      MULTILINGUAL RULES:
      - The user's input may be in English, Sinhala, or a mix of both (Singlish).
      - You MUST fully understand the Sinhala input and extract all product details from it.
      - ALWAYS generate the output description in clear, professional English — regardless of the input language.
      - Common Sinhala product terms you may encounter:
        * දිග (length), පළල (width), උස (height/tall), බර (weight)
        * වර්ණය / රෙද්ද (color), ද්‍රව්‍යය (material), වගකීම (warranty)
        * ගාස්තුව / මිල (price/cost), ප්‍රමාණය (quantity/size)
        * බ්‍රෑන්ඩ් (brand), ගුණාත්මකභාවය (quality)

      OUTPUT RULES:
      1. Return ONLY the HTML body content (no <html>, <head>, <body> tags).
      2. Use <strong> for bold headings/labels, <ul>/<li> for bullet points, <p> for paragraphs.
      3. Structure it with: a short summary paragraph, then key features/specs as bullet points, then any additional info.
      4. Keep a professional, confident tone suitable for a business quotation or invoice.
      5. Do NOT add any markdown, code blocks, or explanations outside the HTML.
      6. If the user mentions specifications (dimensions, weight, color, material, warranty, etc.), include them.
      7. Make it look premium and polished — something a customer would be proud to see on a quotation.

      Example Output:
      <p><strong>Premium Wireless Bluetooth Headphones</strong> — Industry-leading sound with active noise cancellation.</p>
      <ul>
        <li><strong>Driver Size:</strong> 40mm dynamic drivers</li>
        <li><strong>Battery Life:</strong> Up to 30 hours playtime</li>
        <li><strong>Connectivity:</strong> Bluetooth 5.0, 10m range</li>
        <li><strong>Noise Cancellation:</strong> Active hybrid ANC</li>
        <li><strong>Weight:</strong> 250g</li>
        <li><strong>Warranty:</strong> 1 year manufacturer warranty</li>
      </ul>
      <p>Ideal for professionals seeking premium audio quality and all-day comfort.</p>
    `;

    const result = await model.generateContent([systemPrompt, `User description: ${prompt}`]);
    const response = await result.response;
    let text = response.text().replace(/```html/g, "").replace(/```/g, "").trim();

    res.json({ success: true, description: text });
  } catch (error) {
    console.error("Error generating product description:", error);
    const status = error.status || 500;
    const message = error.status === 429
      ? "Rate limit exceeded. Please wait a moment and try again."
      : "Failed to generate description";
    res.status(status).json({ success: false, message, error: error.message });
  }
};

const generateSupplierDetails = (req, res) =>
  generateDetails(req, res, "supplier");
const generateCustomerDetails = (req, res) =>
  generateDetails(req, res, "customer");
const generateProductDetails = (req, res) =>
  generateDetails(req, res, "product");

module.exports = {
  generateSupplierDetails,
  generateCustomerDetails,
  generateProductDetails,
  generateProductDescription,
};


import {
    PromptTemplate,
  } from "langchain/prompts";
  
  const _DEFAULT_SUMMARIZER_TEMPLATE = `From the following html write me a summary that can be used to describe the content of the website. 
  The result should be well structuted and includes only important information like links, buttons, inputs, and summarized text snippets.  
  Your summary should focus in answering the following question: "{focus}". 
  
  Use the following format:
  -------------------------
  Relevant information about the question being asked:
  \\Explanation: A summary of the relevant information and summary of any important pieces of text.
  
  Relevant links, buttons and inputs to the question being asked:
  \\Explanation: Relevant links, buttons and inputs to the question being asked. Format for links: [id="the id of the element", type="the type of element (LINK, BUTTON, INPUT, A)", description="A description of the link"] 
  
  Not Relevant Information in the site:
  \\Explanation: A list of information present but is not relevant to the information we are focusing on.
  -------------------------
  
  Example Response:
  -------------------------
  Relevant information about the question being asked:
  The site is about a company that sells shoes. The company is called "Shoes for you". 
  The company is located in the United States. The company has a contact us page. The company has a recover your password page. 
  The site has a login form. The website also features a section for Sneakers, Nikes and Adidas.
  
  Relevant links, buttons and inputs to the question being asked:
  - [id=2380, type=LINK, description="Go to Recover your password"] 
  - [id=4542, type=LINK, description="Link to a page about their latest offerings."] 
  - [id=3658, type=BUTTON, description="Submit form"] 
  - [id=7643, type=INPUT, description="Login Form username or email address"] 
  
  Not Relevant Information in the site:
  - A legal notice section.
  - Links to the company's social media pages.
  - A section for the company's blog.
  - A section for the company's latest news.
  
  -------------------------
  This is the HTML:
  
  {text}
  `;
  //be a smaller and more compact version of the original
  // eslint-disable-next-line spaced-comment
  export const SUMMARY_PROMPT = /*#__PURE__*/ new PromptTemplate({
    inputVariables: ["focus", "text"],
    template: _DEFAULT_SUMMARIZER_TEMPLATE,
  });
  
  /////////////////////////////////////////
  
  const refinePromptTemplate = 
  `From the following html write me a summary that can be used to describe the content of the website. 
  The result should be well structuted, it includes only important information like links, buttons, inputs, and summarized text snippets.  
  
  Your summary should focus in answering the following question: "{focus}". 
  
  Use the following format:
  -------------------------
  Relevant information about the question being asked:
  \\Explanation: A summary of the relevant information and summary of any important pieces of text.
  
  Relevant links, buttons and inputs to the question being asked:
  \\Explanation: Relevant links, buttons and inputs to the question being asked. Format for links: [id="the id of the element", type="the type of element (LINK, BUTTON, INPUT, A)", description="A description of the link"] 
  
  Not Relevant Information in the site:
  \\Explanation: A list of information present but is not relevant to the information we are focusing on.
  -------------------------
  
  Example Response:
  -------------------------
  Relevant information about the question being asked:
  The site is about a company that sells shoes. The company is called "Shoes for you". 
  The company is located in the United States. The company has a contact us page. The company has a recover your password page. 
  The site has a login form. The website also features a section for Sneakers, Nikes and Adidas.
  
  Relevant links, buttons and inputs to the question being asked:
  - [id=2380, type=LINK, description="Go to Recover your password"] 
  - [id=4542, type=LINK, description="Link to a page about their latest offerings."] 
  - [id=3658, type=BUTTON, description="Submit form"] 
  - [id=7643, type=INPUT, description="Login Form username or email address"] 
  
  Not Relevant Information in the site:
  - A legal notice section.
  - Links to the company's social media pages.
  - A section for the company's blog.
  - A section for the company's latest news.
  
  -------------------------
  
  Your job is to produce a new structured summary of the html.
  We have provided an existing revision up to a certain point:
  "{existing_answer}"
  
  
  
  We have the opportunity to add and refine the existing html page summary (only if needed) with some more context below.
  ------------
  "{text}"
  ------------
  
  Given the new piece of the html, refine the response.
  If the context isn't useful, return the original summary.
  
  SUMMARIZED HTML:`;
  
  export const REFINE_PROMPT = /* #__PURE__ */ new PromptTemplate({
    template: refinePromptTemplate,
    inputVariables: ["existing_answer", "text", "focus"],
  });
  
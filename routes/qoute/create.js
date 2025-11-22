import createQuoteHandler from "../../handlers/createQuote.js";

export default function handler(req, res) {
    return createQuoteHandler(req, res);
}

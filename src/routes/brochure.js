const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/authenticate');
const { asyncHandler } = require('../middleware/errorHandler');
const brochureService = require('../services/brochureService');

router.use(authenticate);

// GET /api/v1/brochure/:listingId/pdf — download PDF
router.get('/:listingId/pdf', asyncHandler(async (req, res) => {
  const { buffer, filename } = await brochureService.generateBrochurePDF(
    req.params.listingId,
    req.user.id
  );

  const safeFilename = (filename || "brochure.pdf")
    .replace(/[\r\n]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_");

  res.attachment(safeFilename);
  res.send(buffer);
}));

// GET /api/v1/brochure/:listingId/preview — HTML preview in browser
router.get('/:listingId/preview', asyncHandler(async (req, res) => {
  const html = await brochureService.generateBrochurePreview(
    req.params.listingId,
    req.user.id
  );
  res.set('Content-Type', 'text/html');
  res.send(html);
}));

module.exports = router;

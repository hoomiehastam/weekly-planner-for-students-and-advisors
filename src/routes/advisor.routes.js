const express = require('express');
const router = express.Router();
const { listActiveAdvisors } = require('../controllers/advisor.controller');

router.get('/', listActiveAdvisors);

module.exports = router;

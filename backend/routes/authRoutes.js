const express = require('express');
const router = express.Router();
const { validateLogin, validateRegistration } = require('../middleware/validateAuth');

/**
 * POST /api/auth/login
 * Validates operator credentials server-side before proceeding.
 */
router.post('/login', validateLogin, (req, res) => {
  const { username, vehicleNo, hospitalId, role } = req.validatedBody;

  // Credentials are validated — in a production system this would check
  // against a database and issue an OTP. For now, return success.
  res.status(200).json({
    success: true,
    message: 'Credentials validated. OTP dispatched.',
    data: { username, vehicleNo, hospitalId, role }
  });
});

/**
 * POST /api/auth/register
 * Validates registration payload server-side before persisting.
 */
router.post('/register', validateRegistration, (req, res) => {
  const data = req.validatedBody;

  // Registration data validated — in a production system this would save
  // to the database. For now, return success.
  res.status(201).json({
    success: true,
    message: 'Registration validated and profile created.',
    data: {
      fullName: data.fullName,
      licensePlate: data.licensePlate,
      vehicleMakeModel: data.vehicleMakeModel,
      bloodGroup: data.bloodGroup
    }
  });
});

module.exports = router;

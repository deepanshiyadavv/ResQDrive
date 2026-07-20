/**
 * Server-side validation middleware for login and registration requests.
 * Enforces:
 *  - Operator Name: alphanumeric only (letters and numbers)
 *  - Vehicle Number: exactly 10 alphanumeric characters (spaces stripped)
 */

const ALPHANUMERIC_REGEX = /^[a-zA-Z0-9]+$/;
const VEHICLE_NO_REGEX = /^[A-Z0-9]{10}$/;

/**
 * Validates login credentials (operator name + vehicle number + hospitalId).
 */
function validateLogin(req, res, next) {
  const { username, vehicleNo, role, hospitalId } = req.body;
  const errors = {};

  // --- Operator Name ---
  if (!username || !username.trim()) {
    errors.username = 'Operator Name is required.';
  } else if (!ALPHANUMERIC_REGEX.test(username.trim())) {
    errors.username = 'Operator Name can only contain letters and numbers.';
  }

  // --- Vehicle Number (required for ambulance role) ---
  if (role === 'ambulance') {
    const rawVehicle = (vehicleNo || '').replace(/\s/g, '').toUpperCase();
    if (!rawVehicle) {
      errors.vehicleNo = 'Incomplete: Vehicle number must be exactly 10 characters.';
    } else if (rawVehicle.length !== 10) {
      errors.vehicleNo = 'Incomplete: Vehicle number must be exactly 10 characters.';
    } else if (!VEHICLE_NO_REGEX.test(rawVehicle)) {
      errors.vehicleNo = 'Vehicle number can only contain uppercase letters and numbers.';
    }
  }

  // --- Hospital ID ---
  if (!hospitalId || !hospitalId.trim()) {
    errors.hospitalId = 'Hospital ID is required.';
  }

  if (Object.keys(errors).length > 0) {
    return res.status(400).json({ success: false, errors });
  }

  // Attach sanitized values for downstream handlers
  req.validatedBody = {
    username: username.trim(),
    vehicleNo: role === 'ambulance' ? (vehicleNo || '').replace(/\s/g, '').toUpperCase() : undefined,
    hospitalId: hospitalId.trim(),
    role
  };

  next();
}

/**
 * Validates registration payload (fullName + licensePlate + other fields).
 */
function validateRegistration(req, res, next) {
  const { fullName, licensePlate, dob, vehicleMakeModel, bloodGroup, consent,
    primaryContactName, primaryContactRelation, primaryContactPhone } = req.body;
  const errors = {};
  const phoneRegex = /^\d{10}$/;

  // --- Full Name (Operator Name) ---
  if (!fullName || !fullName.trim()) {
    errors.fullName = 'Full Name is required.';
  } else if (/[^a-zA-Z0-9 ]/.test(fullName)) {
    errors.fullName = 'Operator Name can only contain letters and numbers.';
  }

  // --- License Plate / Vehicle Number ---
  const rawPlate = (licensePlate || '').replace(/\s/g, '').toUpperCase();
  if (!rawPlate) {
    errors.licensePlate = 'Incomplete: Vehicle number must be exactly 10 characters.';
  } else if (rawPlate.length !== 10) {
    errors.licensePlate = 'Incomplete: Vehicle number must be exactly 10 characters.';
  } else if (!/^[A-Z0-9]{10}$/.test(rawPlate)) {
    errors.licensePlate = 'Vehicle number can only contain uppercase letters and numbers.';
  }

  // --- Other required fields ---
  if (!dob) errors.dob = 'Date of Birth is required.';
  if (!vehicleMakeModel || !vehicleMakeModel.trim()) errors.vehicleMakeModel = 'Vehicle Make & Model is required.';
  if (!bloodGroup) errors.bloodGroup = 'Blood Group is required.';
  if (!consent) errors.consent = 'You must provide consent to register.';

  // --- Primary Contact ---
  if (!primaryContactName || !primaryContactName.trim()) errors.primaryContactName = 'Primary Contact Name is required.';
  if (!primaryContactRelation) errors.primaryContactRelation = 'Relationship is required.';
  if (!primaryContactPhone) {
    errors.primaryContactPhone = 'Phone Number is required.';
  } else if (!phoneRegex.test(primaryContactPhone.replace(/\D/g, ''))) {
    errors.primaryContactPhone = 'Invalid phone number format.';
  }

  if (Object.keys(errors).length > 0) {
    return res.status(400).json({ success: false, errors });
  }

  // Attach sanitized values
  req.validatedBody = {
    ...req.body,
    fullName: fullName.trim(),
    licensePlate: rawPlate
  };

  next();
}

module.exports = { validateLogin, validateRegistration };

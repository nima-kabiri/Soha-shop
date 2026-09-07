const bcrypt = require('bcryptjs');
const db = require('../db/database');

function verifyAdminLogin(username, password) {
  const admin = db.prepare('SELECT * FROM admin_users WHERE username = ?').get(username);
  if (!admin) return null;

  const isValid = bcrypt.compareSync(password, admin.password_hash);
  if (!isValid) return null;

  return { id: admin.id, username: admin.username, fullName: admin.full_name, role: admin.role };
}

function changeAdminPassword(adminId, newPassword) {
  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE admin_users SET password_hash = ? WHERE id = ?').run(hash, adminId);
}

module.exports = { verifyAdminLogin, changeAdminPassword };

import axios from 'axios';
import jwt from 'jsonwebtoken';

async function testTokenDebug() {
  try {
    // Login
    const loginRes = await axios.post('http://localhost:3000/api/login', {
      username: 'testuser',
      password: 'testpass123'
    });
    
    const token = loginRes.data.token;
    const user = loginRes.data.user;
    
    console.log('✓ Logged in');
    console.log('  User:', user);
    console.log('  isAdmin:', user.isAdmin);
    console.log('  Token (first 50 chars):', token.substring(0, 50) + '...');
    
    // Try to decode manually
    try {
      const decoded = jwt.decode(token);
      console.log('  Decoded token:', decoded);
    } catch (e) {
      console.log('  Could not decode:', e.message);
    }
    
    // Now try to call the sync endpoint
    console.log('\nCalling /api/lists (no admin required)...');
    const listsRes = await axios.get(
      'http://localhost:3000/api/lists',
      {
        headers: { Authorization: `Bearer ${token}` }
      }
    );
    console.log('✓ /api/lists works, got', listsRes.data.length, 'lists');
    
    // Now try admin endpoint
    console.log('\nCalling /api/admin/users (admin required)...');
    const adminRes = await axios.get(
      'http://localhost:3000/api/admin/users',
      {
        headers: { Authorization: `Bearer ${token}` }
      }
    );
    console.log('✓ /api/admin/users works, got', adminRes.data.length, 'users');
    
  } catch (err) {
    console.error('Error:', err.response?.data || err.message);
  }
}

testTokenDebug();

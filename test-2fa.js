const axios = require('axios');
const speakeasy = require('speakeasy');

async function test2FA() {
  const baseURL = 'http://localhost:3000';
  
  // Login
  const loginRes = await axios.post(`${baseURL}/api/login`, {
    username: 'testuser',
    password: 'testpass123'
  });
  
  const token = loginRes.data.token;
  console.log('✓ Logged in as testuser');
  console.log('  Token:', token.substring(0, 30) + '...');
  
  // Setup 2FA
  const setupRes = await axios.post(`${baseURL}/api/2fa/setup`, {}, {
    headers: { Authorization: `Bearer ${token}` }
  });
  
  const secret = setupRes.data.secret;
  const backupCodes = setupRes.data.backupCodesForStorage;
  console.log('\n✓ 2FA Setup initiated');
  console.log('  Secret:', secret);
  console.log('  Backup codes count:', backupCodes.length);
  
  // Generate valid TOTP code
  const code = speakeasy.totp({ secret, encoding: 'base32' });
  console.log('\n✓ Generated TOTP code:', code);
  
  // Verify 2FA
  const enableRes = await axios.post(
    `${baseURL}/api/2fa/enable`,
    {
      secret,
      code,
      backupCodesHashed: backupCodes
    },
    {
      headers: { Authorization: `Bearer ${token}` }
    }
  );
  
  console.log('\n✓ 2FA verification response:', enableRes.data);
  
  // Check user status
  const userRes = await axios.get(`${baseURL}/api/users/${loginRes.data.user.id}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  
  console.log('\n✓ User 2FA status after enable:', userRes.data.two_factor_enabled);
  
  // Test login with 2FA
  console.log('\n\n--- Testing login with 2FA enabled ---');
  
  const login2Res = await axios.post(`${baseURL}/api/login`, {
    username: 'testuser',
    password: 'testpass123'
  });
  
  if (login2Res.data.requiresTwoFA) {
    console.log('✓ Login requires 2FA');
    console.log('  Temp token:', login2Res.data.tempToken.substring(0, 30) + '...');
    
    // Generate new code for verification
    const verifyCode = speakeasy.totp({ secret, encoding: 'base32' });
    console.log('  Generated code for verification:', verifyCode);
    
    // Verify 2FA
    const verifyRes = await axios.post(
      `${baseURL}/api/2fa/verify`,
      {
        tempToken: login2Res.data.tempToken,
        code: verifyCode
      }
    );
    
    if (verifyRes.data.token) {
      console.log('✓ 2FA verification successful');
      console.log('  Final token:', verifyRes.data.token.substring(0, 30) + '...');
    } else {
      console.log('✗ 2FA verification failed:', verifyRes.data);
    }
  } else {
    console.log('✗ Login did not require 2FA. User might not have it enabled.');
  }
}

test2FA().catch(err => {
  console.error('Error:', err.response?.data || err.message);
  process.exit(1);
});

import axios from 'axios';

async function checkLoginResponse() {
  try {
    const loginRes = await axios.post('http://localhost:3000/api/login', {
      username: 'testuser',
      password: 'testpass123'
    });
    
    console.log('Login response:', JSON.stringify(loginRes.data, null, 2));
    
  } catch (err) {
    console.error('Error:', err.response?.data || err.message);
  }
}

checkLoginResponse();

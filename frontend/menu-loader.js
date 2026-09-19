// Centralized Menu Component Loader
// This script loads and initializes the shared menu in both index.html and admin.html

window.loadSharedMenu = async function(pageTitle, callback) {
  try {
    // Fetch the menu component
    const response = await fetch('/menu-component.html');
    const menuHtml = await response.text();
    
    // Find the header in the current page and replace it
    const currentHeader = document.querySelector('header.header');
    if (currentHeader) {
      currentHeader.remove();
    }
    
    // Insert the new menu at the beginning of body
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = menuHtml;
    const menuElement = tempDiv.querySelector('header');
    document.body.insertBefore(menuElement, document.body.firstChild);
    
    // Set the page title in the header
    const headerTitle = document.getElementById('headerTitle');
    if (headerTitle) {
      headerTitle.textContent = pageTitle;
    }
    
    // Initialize theme button listeners
    initializeThemeButtons();
    
    // Close menu when clicking outside
    document.addEventListener('click', (e) => {
      const menuContainer = document.querySelector('.header-menu-container');
      if (menuContainer && !menuContainer.contains(e.target)) {
        const dropdown = document.getElementById('headerMenuDropdown');
        if (dropdown) {
          dropdown.classList.remove('active');
        }
      }
    });
    
    // Call the callback function if provided (to initialize page-specific UI)
    if (callback && typeof callback === 'function') {
      callback();
    }
  } catch (error) {
    console.error('Failed to load menu component:', error);
  }
};

// Initialize theme button event listeners
function initializeThemeButtons() {
  const themeButtons = document.querySelectorAll('.theme-btn-icon');
  
  // Load current theme from localStorage (try both keys for compatibility)
  let currentTheme = localStorage.getItem('theme') || localStorage.getItem('app-theme') || 'system';
  updateThemeButtons(currentTheme);
  
  // Apply initial theme
  applyTheme(currentTheme);
  
  // Add click listeners
  themeButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const theme = btn.getAttribute('data-theme');
      applyTheme(theme);
    });
  });
}

function updateThemeButtons(theme) {
  document.querySelectorAll('.theme-btn-icon').forEach(btn => {
    btn.classList.remove('active');
    if (btn.getAttribute('data-theme') === theme) {
      btn.classList.add('active');
    }
  });
}

// Theme application
function applyTheme(theme) {
  localStorage.setItem('theme', theme);
  localStorage.setItem('app-theme', theme); // Keep both for compatibility
  updateThemeButtons(theme);
  
  if (theme === 'system') {
    const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
  } else {
    document.documentElement.setAttribute('data-theme', theme);
  }
}

// Toggle header menu visibility
window.toggleHeaderMenu = function() {
  const dropdown = document.getElementById('headerMenuDropdown');
  if (dropdown) {
    dropdown.classList.toggle('active');
  }
};

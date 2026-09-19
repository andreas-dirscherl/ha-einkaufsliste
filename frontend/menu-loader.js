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
    
    // Store pageTitle in window for later use
    window.currentPageTitle = pageTitle;
    
    // Call the callback function if provided (to initialize page-specific UI)
    if (callback && typeof callback === 'function') {
      callback();
    }
    
    // Update navigation links as fallback (in case callback doesn't call it)
    // Use a delay to ensure DOM and user data are ready
    setTimeout(() => {
      updateNavigationLinks(pageTitle);
      // Also update user display with proper picture - ensures it works in both pages
      if (typeof updateUserDisplayWithPicture === 'function') {
        updateUserDisplayWithPicture();
      }
    }, 500);
  } catch (error) {
    console.error('Failed to load menu component:', error);
  }
};

// Update navigation links based on admin status and current page
window.updateNavigationLinks = function(pageTitle) {
  console.log('[updateNavigationLinks] Called with pageTitle:', pageTitle, 'User:', window.user);
  
  const menuLinkHome = document.getElementById('menuLinkHome');
  const menuLinkAdmin = document.getElementById('menuLinkAdmin');
  
  if (!menuLinkHome || !menuLinkAdmin) {
    console.warn('[updateNavigationLinks] Menu elements not found');
    return;
  }
  
  // Show admin link only if user is admin and NOT on admin page
  if (window.user?.is_admin && !pageTitle.includes('Admin')) {
    menuLinkAdmin.style.display = 'flex';
    menuLinkHome.style.display = 'flex';
    console.log('[updateNavigationLinks] App page (admin user) - showing both links');
  } else if (window.user?.is_admin && pageTitle.includes('Admin')) {
    // On admin page as admin - show only home link
    menuLinkHome.style.display = 'flex';
    menuLinkAdmin.style.display = 'none';
    console.log('[updateNavigationLinks] Admin page (admin user) - hiding admin link');
  } else {
    // Non-admin or no user - hide admin link
    menuLinkAdmin.style.display = 'none';
    menuLinkHome.style.display = 'flex';
    console.log('[updateNavigationLinks] Non-admin or no user - hiding admin link');
  }
};

// Update user display in header menu with profile picture if available
window.updateUserDisplayWithPicture = function() {
  const maxRetries = 10;
  let retries = 0;
  const interval = setInterval(() => {
    const userDisplayLabel = document.getElementById('userDisplayLabel');
    const userInitial = document.getElementById('userInitial');
    const userAvatar = document.querySelector('[id*="userAvatar"]') || document.querySelector('[style*="background: var(--color-primary)"]');
    
    if (userDisplayLabel && userInitial) {
      if (window.user?.username) {
        userDisplayLabel.textContent = window.user.username;
        userInitial.textContent = window.user.username.charAt(0).toUpperCase();
        
        // If profile picture is available, update avatar to show image
        if (window.user.profile_picture_url && userAvatar) {
          userAvatar.innerHTML = `<img src="${window.user.profile_picture_url}" alt="${window.user.username}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;">`;
        }
      }
      clearInterval(interval);
    } else if (retries++ >= maxRetries) {
      clearInterval(interval);
      console.warn('[MENU] User elements not found after retries');
    }
  }, 50);
};
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

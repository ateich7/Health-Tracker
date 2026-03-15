const SUPABASE_URL = 'https://eewgjegdxtaqvdlnagny.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_qox_jEnHQF7ZIHenHqlHeg_YmkjlCy5';

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Drive the whole app from auth state — handles both initial load and magic-link redirects
let appInitialized = false;

db.auth.onAuthStateChange((event, session) => {
  if (session && !appInitialized) {
    appInitialized = true;
    document.getElementById('authScreen').style.display = 'none';
    initApp();
  } else if (!session && !appInitialized) {
    // No session on first load — show login
    document.getElementById('loadingOverlay').classList.add('hidden');
    document.getElementById('authScreen').style.display = 'flex';
  } else if (!session && appInitialized) {
    // Signed out — reload to clean state
    window.location.reload();
  }
});

async function sendMagicLink() {
  const email = document.getElementById('authEmail').value.trim();
  const msg   = document.getElementById('authMessage');
  if (!email) return;

  const { error } = await db.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin }
  });

  if (error) {
    msg.style.color = 'var(--binactive)';
    msg.textContent = error.message;
  } else {
    msg.style.color = 'var(--s600)';
    msg.textContent = 'Check your email for the sign-in link.';
    document.getElementById('authEmail').disabled = true;
    document.querySelector('#authScreen .btn-primary').disabled = true;
  }
}

async function signOut() {
  await db.auth.signOut();
}

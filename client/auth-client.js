import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signOut as firebaseSignOut } from 'firebase/auth';

let auth;
export function initializeAuth(config, onChange) {
  const app = getApps().length ? getApp() : initializeApp(config);
  auth = getAuth(app);
  return new Promise((resolve, reject) => {
    let initial = true;
    onAuthStateChanged(auth, user => {
      onChange(user);
      if (initial) { initial = false; resolve(user); }
    }, error => {
      if (initial) { initial = false; reject(error); }
      else onChange(null);
    });
  });
}
export async function getAuthToken(forceRefresh = false) {
  if (!auth?.currentUser) throw new Error('Google アカウントでログインしてください。');
  return auth.currentUser.getIdToken(forceRefresh);
}
export async function signIn() {
  if (!auth) throw new Error('ログインの準備ができていません。');
  return signInWithPopup(auth, new GoogleAuthProvider());
}
export async function signOut() {
  if (auth) await firebaseSignOut(auth);
}

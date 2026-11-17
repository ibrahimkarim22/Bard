import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { NativeModules, Platform } from 'react-native';
import { EmailAuthProvider, reauthenticateWithCredential, deleteUser } from 'firebase/auth';
import * as firestore from 'firebase/firestore';
import { FIREBASE_APP, FIREBASE_AUTH, FIRESTORE_DB } from '../firebaseConfig';
import { normalHighlightRuntime } from '../reader/normalHighlightStore';
import { createDeletionStorage } from './deletionStorage';
import { createSparkDeletionCloud } from './sparkDeletionCloud';
import { createSparkDeletionController } from './sparkDeletionController';
import { ACCOUNT_DELETION } from './deletionActivation';
import { runAuthMutation } from './authMutationGate';

function ticket() {
  try {
    const bytes = new Uint8Array(32);
    const native = globalThis.expo?.modules?.ExpoCrypto;
    if (Platform.OS === 'web' && globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
    else if (native?.getRandomValues) native.getRandomValues(bytes);
    else {
      const encoded = NativeModules.RNGetRandomValues?.getRandomBase64(32);
      if (typeof encoded !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(encoded)) throw new Error();
      const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
      let accumulator = 0, bits = 0, index = 0;
      for (const character of encoded.slice(0, -1)) {
        accumulator = (accumulator << 6) | alphabet.indexOf(character);
        bits += 6;
        if (bits >= 8) {
          bits -= 8;
          bytes[index++] = (accumulator >>> bits) & 255;
        }
      }
      if (index !== bytes.length || (accumulator & 3) !== 0) throw new Error();
    }
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  } catch {
    throw Object.assign(new Error('Secure randomness is unavailable.'), { code: 'ACCOUNT_DELETION_RANDOM_UNAVAILABLE' });
  }
}

const storage = createDeletionStorage({ storage: AsyncStorage, secureStore: SecureStore, runtime: normalHighlightRuntime, mode: 'spark' });
const cloud = createSparkDeletionCloud({ db: FIRESTORE_DB, sdk: firestore, projectId: FIREBASE_APP.options.projectId,
  getUser: () => FIREBASE_AUTH.currentUser });
export const accountDeletion = createSparkDeletionController({
  enabled: ACCOUNT_DELETION.enabled && FIREBASE_APP.options.projectId === ACCOUNT_DELETION.projectId,
  getUser: () => FIREBASE_AUTH.currentUser,
  async reauthenticate(user, password) {
    const result = await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password));
    // Keep credentials bound to the captured account throughout reauthentication.
    return { uid: result.user.uid, idToken: await result.user.getIdToken(true) };
  },
  generateTicket: ticket, storage, runtime: normalHighlightRuntime, cloud,
  deleteAuth(user, { isActive } = {}) {
    return runAuthMutation(async () => {
      if (FIREBASE_AUTH.currentUser !== user) throw Object.assign(new Error('Account changed.'), { code: 'ACCOUNT_DELETION_OTHER_ACCOUNT' });
      if (typeof isActive !== 'function' || isActive() !== true) throw Object.assign(new Error('Deletion paused.'), { code: 'ACCOUNT_DELETION_PAUSED' });
      // Firebase deletes the captured user's login only after cloud cleanup has
      // been server-confirmed. Its normal Auth listener handles local sign-out.
      await deleteUser(user);
    });
  },
});

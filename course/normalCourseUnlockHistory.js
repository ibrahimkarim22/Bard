import AsyncStorage from '@react-native-async-storage/async-storage';
import { createCourseUnlockHistory } from './courseUnlockHistory';

export const normalCourseUnlockHistory = createCourseUnlockHistory(AsyncStorage);

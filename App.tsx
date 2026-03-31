import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';

import { initializeDatabase, resetDatabase } from './services/database';
import {
  downloadAllBooks,
  getDownloadProgress,
  isBibleDownloadComplete,
  DownloadProgressCallback,
} from './services/bibleDownload';

// ─── Screen states ────────────────────────────────────────────────────────────

type Screen =
  | { type: 'loading' }
  | { type: 'error'; message: string }
  | { type: 'welcome' }
  | { type: 'downloading' }
  | { type: 'navigator' };

// ─── Download progress shape ──────────────────────────────────────────────────

interface DownloadState {
  currentBook: string;
  overallChaptersCompleted: number;
  overallTotalChapters: number;
}

// ─── Root component ───────────────────────────────────────────────────────────

export default function App() {
  const [screen, setScreen] = useState<Screen>({ type: 'loading' });
  const [downloadState, setDownloadState] = useState<DownloadState>({
    currentBook: '',
    overallChaptersCompleted: 0,
    overallTotalChapters: 1, // avoid division by zero before first callback
  });

  // ── Initialization ──────────────────────────────────────────────────────────

  const initialize = useCallback(async () => {
    setScreen({ type: 'loading' });
    try {
      await initializeDatabase();
      await resetDatabase(); // TEMPORARY: remove after parser fix
      const complete = await isBibleDownloadComplete();
      if (complete) {
        setScreen({ type: 'navigator' });
      } else {
        // Seed the progress display with whatever's already cached
        const { completedChapters, totalChapters } = await getDownloadProgress();
        setDownloadState({
          currentBook: '',
          overallChaptersCompleted: completedChapters,
          overallTotalChapters: totalChapters,
        });
        setScreen({ type: 'welcome' });
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'An unexpected error occurred during initialization.';
      setScreen({ type: 'error', message });
    }
  }, []);

  useEffect(() => {
    initialize();
  }, [initialize]);

  // ── Download trigger ────────────────────────────────────────────────────────

  const handleSetUpBible = useCallback(async () => {
    setScreen({ type: 'downloading' });

    const onProgress: DownloadProgressCallback = (progress) => {
      setDownloadState({
        currentBook: progress.currentBook,
        overallChaptersCompleted: progress.overallChaptersCompleted,
        overallTotalChapters: progress.overallTotalChapters,
      });
    };

    try {
      await downloadAllBooks(onProgress);
      setScreen({ type: 'navigator' });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Download failed unexpectedly.';
      setScreen({ type: 'error', message });
    }
  }, []);

  // ── Render ──────────────────────────────────────────────────────────────────

  if (screen.type === 'loading') {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#333" />
        <StatusBar style="dark" />
      </View>
    );
  }

  if (screen.type === 'error') {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{screen.message}</Text>
        <TouchableOpacity style={styles.button} onPress={initialize}>
          <Text style={styles.buttonText}>Retry</Text>
        </TouchableOpacity>
        <StatusBar style="dark" />
      </View>
    );
  }

  if (screen.type === 'navigator') {
    return (
      <View style={styles.centered}>
        <Text style={styles.placeholder}>Bible Navigator — coming next</Text>
        <StatusBar style="dark" />
      </View>
    );
  }

  if (screen.type === 'welcome') {
    return (
      <View style={styles.centered}>
        <Text style={styles.appName}>Kardia</Text>
        <Text style={styles.tagline}>Recovering what the text actually says</Text>
        <TouchableOpacity style={styles.button} onPress={handleSetUpBible}>
          <Text style={styles.buttonText}>Set Up My Bible</Text>
        </TouchableOpacity>
        <StatusBar style="dark" />
      </View>
    );
  }

  // screen.type === 'downloading'
  const { currentBook, overallChaptersCompleted, overallTotalChapters } = downloadState;
  const progress = overallChaptersCompleted / overallTotalChapters;
  const percentage = Math.round(progress * 100);

  return (
    <View style={styles.centered}>
      <Text style={styles.appName}>Kardia</Text>
      <View style={styles.downloadSection}>
        <Text style={styles.downloadingLabel}>
          {currentBook ? `Downloading ${currentBook}...` : 'Starting download…'}
        </Text>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${percentage}%` }]} />
        </View>
        <Text style={styles.percentageLabel}>{percentage}%</Text>
      </View>
      <StatusBar style="dark" />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  appName: {
    fontSize: 48,
    fontWeight: '300',
    color: '#111',
    letterSpacing: 2,
    marginBottom: 12,
  },
  tagline: {
    fontSize: 15,
    color: '#666',
    textAlign: 'center',
    marginBottom: 48,
  },
  button: {
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 6,
    paddingVertical: 12,
    paddingHorizontal: 28,
  },
  buttonText: {
    fontSize: 15,
    color: '#333',
  },
  downloadSection: {
    width: '100%',
    alignItems: 'center',
    marginTop: 32,
  },
  downloadingLabel: {
    fontSize: 15,
    color: '#444',
    marginBottom: 16,
    textAlign: 'center',
  },
  progressTrack: {
    width: '100%',
    height: 4,
    backgroundColor: '#e0e0e0',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#333',
    borderRadius: 2,
  },
  percentageLabel: {
    fontSize: 13,
    color: '#888',
    marginTop: 8,
  },
  errorText: {
    fontSize: 14,
    color: '#c00',
    textAlign: 'center',
    marginBottom: 24,
  },
  placeholder: {
    fontSize: 16,
    color: '#555',
  },
});

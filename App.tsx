import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  PanResponder,
  PanResponderInstance,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';

import {
  initializeDatabase,
  removeTranslationData,
  getChapterVerses,
  type BibleVerse,
  type KardiaTranslationRecord,
  sanitizeKardiaTranslations,
} from './services/database';
import type { KeyTermDetails } from './types/kardia';
import { getOrCreateKardiaTranslation } from './services/kardiaTranslator';
import { looksLikeKardiaJson, parseKardiaJson } from './services/kardiaParser';
import {
  importBibleFromJson,
  isBibleImportComplete,
  ImportProgressCallback,
} from './services/bibleImport';
import { TRANSLATION_CODE } from './constants/config';
import { BIBLE_BOOKS } from './constants/bibleMetadata';

type AppPhase = 'loading' | 'ready' | 'error';
type HomeView = 'welcome' | 'importing' | 'navigator';
type TabKey = 'home' | 'settings';
type TranslationStatus = 'not_installed' | 'installing' | 'installed';

interface ImportState {
  currentBook: string;
  booksCompleted: number;
  totalBooks: number;
  translationName: string;
}

interface TranslationOption {
  code: string;
  name: string;
  description?: string;
  loadData: () => Record<string, unknown>;
}

interface KardiaRequestContext {
  sourceTranslationCode: string;
  book: string;
  chapter: number;
  verse: number;
  sourceText: string;
}

type KardiaModalStatus = 'idle' | 'loading' | 'success' | 'error';

const TRANSLATIONS: TranslationOption[] = [
  {
    code: 'ESV',
    name: 'English Standard Version',
    description: 'Crossway · 2016 text',
    loadData: () => require('./assets/bibles/esv.json'),
  },
];

const tabs: { key: TabKey; label: string }[] = [
  { key: 'home', label: 'Home' },
  { key: 'settings', label: 'Settings' },
];

function buildStatusMap(activeCode: string | null, isComplete: boolean): Record<string, TranslationStatus> {
  const map: Record<string, TranslationStatus> = {};
  TRANSLATIONS.forEach((option) => {
    map[option.code] = 'not_installed';
  });
  if (isComplete && activeCode) {
    map[activeCode] = 'installed';
  }
  return map;
}

export default function App() {
  const [phase, setPhase] = useState<AppPhase>('loading');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [currentTab, setCurrentTab] = useState<TabKey>('home');
  const [homeView, setHomeView] = useState<HomeView>('welcome');
  const [activeTranslationCode, setActiveTranslationCode] = useState<string | null>(null);
  const [translationStatuses, setTranslationStatuses] = useState<Record<string, TranslationStatus>>(() =>
    buildStatusMap(null, false),
  );
  const [importState, setImportState] = useState<ImportState>({
    currentBook: '',
    booksCompleted: 0,
    totalBooks: 66,
    translationName: '',
  });
  const [selectedBookIndex, setSelectedBookIndex] = useState(0);
  const [selectedChapter, setSelectedChapter] = useState(1);
  const [verses, setVerses] = useState<BibleVerse[]>([]);
  const [isChapterLoading, setIsChapterLoading] = useState(false);
  const [chapterError, setChapterError] = useState<string | null>(null);
  const [chapterUnavailable, setChapterUnavailable] = useState(false);
  const [isPickerVisible, setPickerVisible] = useState(false);
  const [pickerBookIndex, setPickerBookIndex] = useState<number | null>(null);
  const [pickerTestament, setPickerTestament] = useState<'ot' | 'nt'>('ot');
  const [isTranslationModalVisible, setTranslationModalVisible] = useState(false);
  const [isKardiaModalVisible, setKardiaModalVisible] = useState(false);
  const [kardiaContext, setKardiaContext] = useState<KardiaRequestContext | null>(null);
  const [kardiaStatus, setKardiaStatus] = useState<KardiaModalStatus>('idle');
  const [kardiaRecord, setKardiaRecord] = useState<KardiaTranslationRecord | null>(null);
  const [kardiaError, setKardiaError] = useState<string | null>(null);
  const parsedKeyTerm = useMemo<KeyTermDetails | null>(() => {
    if (!kardiaRecord?.key_term_notes) {
      return null;
    }
    try {
      const parsed = JSON.parse(kardiaRecord.key_term_notes) as KeyTermDetails;
      if (parsed && (parsed.term || parsed.notes)) {
        return parsed;
      }
    } catch {
      return null;
    }
    return null;
  }, [kardiaRecord]);
  const parsedExtraNotes = useMemo<string[]>(() => {
    if (!kardiaRecord?.extra_notes) {
      return [];
    }
    try {
      const notes = JSON.parse(kardiaRecord.extra_notes) as unknown;
      if (Array.isArray(notes)) {
        return notes
          .filter((note): note is string => typeof note === 'string' && note.trim().length > 0)
          .map((note) => note.trim());
      }
    } catch {
      return [];
    }
    return [];
  }, [kardiaRecord]);
  const legacyParsedPayload = useMemo(() => {
    const sourceJson =
      kardiaRecord?.kardia_text && looksLikeKardiaJson(kardiaRecord.kardia_text)
        ? kardiaRecord.kardia_text
        : kardiaRecord?.raw_response_json && looksLikeKardiaJson(kardiaRecord.raw_response_json)
          ? kardiaRecord.raw_response_json
          : null;
    if (!sourceJson) {
      return null;
    }
    return parseKardiaJson(sourceJson);
  }, [kardiaRecord]);
  const effectiveSourceText =
    legacyParsedPayload?.sourceText ??
    kardiaRecord?.source_text ??
    kardiaContext?.sourceText ??
    '';
  const effectiveKardiaText = legacyParsedPayload?.kardiaText ?? kardiaRecord?.kardia_text ?? '';
  const effectiveKeyTerm = legacyParsedPayload?.keyTerm
    ? {
        term: legacyParsedPayload.keyTerm.term ?? null,
        notes: legacyParsedPayload.keyTerm.notes ?? null,
      }
    : parsedKeyTerm;
  const effectiveHebrewWord =
    legacyParsedPayload?.hebrewWord ??
    legacyParsedPayload?.keyTerm?.hebrew ??
    kardiaRecord?.hebrew_word ??
    null;
  const effectiveHebrewCategory =
    legacyParsedPayload?.hebrewCategory ?? kardiaRecord?.hebrew_category ?? null;
  const effectiveWhyThisMatters =
    legacyParsedPayload?.whyThisMatters ?? kardiaRecord?.why_this_matters ?? null;
  const effectiveExtraNotes = legacyParsedPayload?.extraNotes ?? parsedExtraNotes;
  const hasKeyTermCard = Boolean(effectiveKeyTerm?.term || effectiveHebrewWord);
  const hasInsights =
    Boolean(effectiveKeyTerm?.notes) ||
    Boolean(effectiveHebrewCategory) ||
    Boolean(effectiveWhyThisMatters) ||
    effectiveExtraNotes.length > 0;

  const installedTranslations = useMemo(
    () => TRANSLATIONS.filter((option) => translationStatuses[option.code] === 'installed'),
    [translationStatuses],
  );

  const oldTestamentBooks = useMemo(
    () => BIBLE_BOOKS.slice(0, 39).map((book, index) => ({ book, index })),
    [],
  );
  const newTestamentBooks = useMemo(
    () => BIBLE_BOOKS.slice(39).map((book, index) => ({ book, index: index + 39 })),
    [],
  );

  const initialize = useCallback(async () => {
    setPhase('loading');
    try {
      initializeDatabase();
      sanitizeKardiaTranslations();
      const complete = isBibleImportComplete();
      const activeCode = complete ? TRANSLATION_CODE : null;
      setTranslationStatuses(buildStatusMap(activeCode, complete));
      setActiveTranslationCode(activeCode);
      setHomeView(complete ? 'navigator' : 'welcome');
      setPhase('ready');
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'An unexpected error occurred during initialization.';
      setErrorMessage(message);
      setPhase('error');
    }
  }, []);

  useEffect(() => {
    initialize();
  }, [initialize]);

  const loadChapter = useCallback(
    (bookIndex: number, chapterNumber: number) => {
      if (!activeTranslationCode) {
        return;
      }
      const bookMeta = BIBLE_BOOKS[bookIndex];
      if (!bookMeta) {
        return;
      }
      setIsChapterLoading(true);
      setChapterError(null);
      try {
        const result = getChapterVerses(activeTranslationCode, bookMeta.name, chapterNumber);
        setVerses(result);
        setChapterUnavailable(result.length === 0);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to load chapter.';
        setChapterError(message);
        setVerses([]);
        setChapterUnavailable(false);
      } finally {
        setIsChapterLoading(false);
      }
    },
    [activeTranslationCode],
  );

  useEffect(() => {
    if (homeView !== 'navigator' || !activeTranslationCode) {
      return;
    }
    loadChapter(selectedBookIndex, selectedChapter);
  }, [homeView, activeTranslationCode, selectedBookIndex, selectedChapter, loadChapter]);

  const startImport = useCallback(
    async (option: TranslationOption) => {
      const status = translationStatuses[option.code];
      if (status === 'installing' || status === 'installed') {
        return;
      }

      setTranslationStatuses((prev) => ({ ...prev, [option.code]: 'installing' }));
      setImportState({
        currentBook: '',
        booksCompleted: 0,
        totalBooks: 66,
        translationName: option.name,
      });
      setHomeView('importing');
      setCurrentTab('home');

      try {
        const translationData = option.loadData();
        const onProgress: ImportProgressCallback = (event) => {
          setImportState({
            currentBook: event.currentBook,
            booksCompleted: event.booksCompleted,
            totalBooks: event.totalBooks,
            translationName: option.name,
          });
        };

        const result = await importBibleFromJson(option.code, translationData, onProgress);
        if (result.warnings.length > 0) {
          console.warn('[App] Import warnings:', result.warnings);
        }

        setTranslationStatuses((prev) => ({ ...prev, [option.code]: 'installed' }));
        setActiveTranslationCode(option.code);
        setHomeView('navigator');
      } catch (error) {
        setTranslationStatuses((prev) => ({ ...prev, [option.code]: 'not_installed' }));
        const message = error instanceof Error ? error.message : 'Import failed unexpectedly.';
        setErrorMessage(message);
        setPhase('error');
      }
    },
    [translationStatuses],
  );

  const uninstallTranslation = useCallback(
    (option: TranslationOption) => {
      try {
        removeTranslationData(option.code);
        setTranslationStatuses((prev) => ({ ...prev, [option.code]: 'not_installed' }));
        if (activeTranslationCode === option.code) {
          setActiveTranslationCode(null);
          setHomeView('welcome');
          setCurrentTab('home');
          setVerses([]);
          setChapterUnavailable(false);
          setChapterError(null);
        }
      } catch (error) {
        console.error('[App] Failed to uninstall translation', error);
        const message = error instanceof Error ? error.message : 'Failed to uninstall translation.';
        setErrorMessage(message);
        setPhase('error');
      }
    },
    [activeTranslationCode],
  );

  const getPrevChapterInfo = useCallback(() => {
    if (selectedChapter > 1) {
      return { bookIndex: selectedBookIndex, chapter: selectedChapter - 1 };
    }
    if (selectedBookIndex > 0) {
      const prevBook = BIBLE_BOOKS[selectedBookIndex - 1];
      return { bookIndex: selectedBookIndex - 1, chapter: prevBook.chapters.length };
    }
    return null;
  }, [selectedBookIndex, selectedChapter]);

  const getNextChapterInfo = useCallback(() => {
    const currentBook = BIBLE_BOOKS[selectedBookIndex];
    if (!currentBook) {
      return null;
    }
    if (selectedChapter < currentBook.chapters.length) {
      return { bookIndex: selectedBookIndex, chapter: selectedChapter + 1 };
    }
    if (selectedBookIndex < BIBLE_BOOKS.length - 1) {
      return { bookIndex: selectedBookIndex + 1, chapter: 1 };
    }
    return null;
  }, [selectedBookIndex, selectedChapter]);

  const hasPrevChapter = useMemo(() => getPrevChapterInfo() !== null, [getPrevChapterInfo]);
  const hasNextChapter = useMemo(() => getNextChapterInfo() !== null, [getNextChapterInfo]);

  const goToPrevChapter = useCallback(() => {
    if (isChapterLoading) {
      return;
    }
    const prev = getPrevChapterInfo();
    if (!prev) {
      return;
    }
    setSelectedBookIndex(prev.bookIndex);
    setSelectedChapter(prev.chapter);
  }, [getPrevChapterInfo, isChapterLoading]);

  const goToNextChapter = useCallback(() => {
    if (isChapterLoading) {
      return;
    }
    const next = getNextChapterInfo();
    if (!next) {
      return;
    }
    setSelectedBookIndex(next.bookIndex);
    setSelectedChapter(next.chapter);
  }, [getNextChapterInfo, isChapterLoading]);

  const panResponder = useMemo<PanResponderInstance>(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gestureState) => {
          if (isChapterLoading) {
            return false;
          }
          const horizontal = Math.abs(gestureState.dx);
          const vertical = Math.abs(gestureState.dy);
          return horizontal > vertical && horizontal > 25;
        },
        onPanResponderRelease: (_, gestureState) => {
          if (isChapterLoading) {
            return;
          }
          if (gestureState.dx < -40 && hasNextChapter) {
            goToNextChapter();
          } else if (gestureState.dx > 40 && hasPrevChapter) {
            goToPrevChapter();
          }
        },
      }),
    [goToNextChapter, goToPrevChapter, hasNextChapter, hasPrevChapter, isChapterLoading],
  );

  const openPicker = useCallback(() => {
    setPickerVisible(true);
    setPickerBookIndex(null);
    setPickerTestament(selectedBookIndex < 39 ? 'ot' : 'nt');
  }, [selectedBookIndex]);

  const handleChapterSelect = useCallback(
    (bookIndex: number, chapterNumber: number) => {
      setSelectedBookIndex(bookIndex);
      setSelectedChapter(chapterNumber);
      setPickerVisible(false);
      setPickerBookIndex(null);
      setHomeView('navigator');
    },
    [],
  );

  const loadKardiaTranslation = useCallback(async (context: KardiaRequestContext) => {
    setKardiaStatus('loading');
    setKardiaError(null);
    setKardiaRecord(null);
    try {
      const record = await getOrCreateKardiaTranslation(context);
      setKardiaRecord(record);
      setKardiaStatus('success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to generate translation.';
      setKardiaError(message);
      setKardiaStatus('error');
    }
  }, []);

  const handleVersePress = useCallback(
    (verseItem: BibleVerse) => {
      if (!activeTranslationCode) {
        return;
      }
      const bookMeta = BIBLE_BOOKS[selectedBookIndex] ?? BIBLE_BOOKS[0];
      const context: KardiaRequestContext = {
        sourceTranslationCode: activeTranslationCode,
        book: bookMeta.name,
        chapter: selectedChapter,
        verse: verseItem.verse,
        sourceText: verseItem.text,
      };
      setKardiaContext(context);
      setKardiaModalVisible(true);
      loadKardiaTranslation(context);
    },
    [activeTranslationCode, selectedBookIndex, selectedChapter, loadKardiaTranslation],
  );

  const closeKardiaModal = useCallback(() => {
    setKardiaModalVisible(false);
    setKardiaContext(null);
    setKardiaRecord(null);
    setKardiaStatus('idle');
    setKardiaError(null);
  }, []);

  const retryKardiaTranslation = useCallback(() => {
    if (kardiaContext) {
      loadKardiaTranslation(kardiaContext);
    }
  }, [kardiaContext, loadKardiaTranslation]);

  const openTranslationModal = useCallback(() => {
    setTranslationModalVisible(true);
  }, []);

  const closeTranslationModal = useCallback(() => {
    setTranslationModalVisible(false);
  }, []);

  const handleSelectTranslation = useCallback(
    (code: string) => {
      if (translationStatuses[code] !== 'installed') {
        return;
      }
      if (activeTranslationCode === code) {
        setTranslationModalVisible(false);
        return;
      }
      setActiveTranslationCode(code);
      setHomeView('navigator');
      setTranslationModalVisible(false);
    },
    [activeTranslationCode, translationStatuses],
  );

  const handleManageTranslationsPress = useCallback(() => {
    setTranslationModalVisible(false);
    setCurrentTab('settings');
  }, []);

  const renderReader = () => {
    const currentBook = BIBLE_BOOKS[selectedBookIndex] ?? BIBLE_BOOKS[0];
    const title = `${currentBook.name} ${selectedChapter}`;
    return (
      <View style={styles.readerContainer}>
        <View style={styles.readerHeader}>
          <TouchableOpacity
            style={styles.navArrow}
            onPress={goToPrevChapter}
            disabled={!hasPrevChapter || isChapterLoading}
          >
            <Text
              style={[
                styles.navArrowText,
                (!hasPrevChapter || isChapterLoading) && styles.navArrowDisabled,
              ]}
            >
              ‹
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.readerTitle} onPress={openPicker}>
            <Text style={styles.readerTitleText}>{title}</Text>
            <Text style={styles.readerTitleCaret}>▾</Text>
          </TouchableOpacity>
          <View style={styles.readerHeaderRight}>
            <TouchableOpacity style={styles.translationPillButton} onPress={openTranslationModal}>
              <Text style={styles.translationPillText}>
                {activeTranslationCode ?? 'Select translation'}
              </Text>
              <Text style={styles.translationPillCaret}>▾</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.navArrow}
              onPress={goToNextChapter}
              disabled={!hasNextChapter || isChapterLoading}
            >
              <Text
                style={[
                  styles.navArrowText,
                  (!hasNextChapter || isChapterLoading) && styles.navArrowDisabled,
                ]}
              >
                ›
              </Text>
            </TouchableOpacity>
          </View>
        </View>
        <View style={styles.readerBody} {...panResponder.panHandlers}>
          {isChapterLoading ? (
            <ActivityIndicator style={styles.readerLoading} size="large" color="#333" />
          ) : chapterError ? (
            <View style={styles.chapterMessage}>
              <Text style={styles.errorText}>{chapterError}</Text>
              <TouchableOpacity
                style={styles.button}
                onPress={() => loadChapter(selectedBookIndex, selectedChapter)}
              >
                <Text style={styles.buttonText}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : chapterUnavailable ? (
            <View style={styles.chapterMessage}>
              <Text style={styles.placeholder}>This chapter is not downloaded yet.</Text>
              <TouchableOpacity style={styles.button} onPress={() => setCurrentTab('settings')}>
                <Text style={styles.buttonText}>Manage translations</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <FlatList
              data={verses}
              keyExtractor={(item) => String(item.verse)}
              renderItem={({ item }) => (
                <TouchableOpacity style={styles.verseRow} onPress={() => handleVersePress(item)}>
                  <Text style={styles.verseNumber}>{item.verse}</Text>
                  <Text style={styles.verseText}>{item.text}</Text>
                </TouchableOpacity>
              )}
              contentContainerStyle={styles.verseListContent}
            />
          )}
        </View>
      </View>
    );
  };

  const renderHome = () => {
    if (homeView === 'welcome') {
      return (
        <View style={styles.centeredContent}>
          <Text style={styles.appName}>Kardia</Text>
          <Text style={styles.tagline}>Recovering what the text actually says</Text>
          <TouchableOpacity style={styles.button} onPress={() => setCurrentTab('settings')}>
            <Text style={styles.buttonText}>Choose a translation to import</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (homeView === 'importing') {
      const progress =
        importState.totalBooks === 0 ? 0 : importState.booksCompleted / importState.totalBooks;
      const percentage = Math.round(Math.min(progress * 100, 100));
      return (
        <View style={styles.centeredContent}>
          <Text style={styles.appName}>Kardia</Text>
          <View style={styles.importSection}>
            <Text style={styles.translationLabel}>{importState.translationName}</Text>
            <Text style={styles.importingLabel}>
              {importState.currentBook
                ? `Importing ${importState.currentBook}...`
                : 'Preparing import…'}
            </Text>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${percentage}%` }]} />
            </View>
            <Text style={styles.percentageLabel}>{`${percentage}%`}</Text>
          </View>
        </View>
      );
    }

    return renderReader();
  };

  const renderSettings = () => (
    <ScrollView contentContainerStyle={styles.settingsContent}>
      <TouchableOpacity style={styles.closeSettingsButton} onPress={() => setCurrentTab('home')}>
        <Text style={styles.closeSettingsButtonText}>Close</Text>
      </TouchableOpacity>
      <Text style={styles.settingsHeading}>Translations</Text>
      <Text style={styles.settingsDescription}>
        Install translations to read offline and switch between them while studying.
      </Text>
      <View style={styles.translationList}>
        {TRANSLATIONS.map((option) => {
          const status = translationStatuses[option.code] ?? 'not_installed';
          const isActive = activeTranslationCode === option.code && status === 'installed';
          const actionLabel =
            status === 'installed' ? 'Installed' : status === 'installing' ? 'Importing…' : 'Import';
          return (
            <View key={option.code} style={styles.translationItem}>
              <Text style={styles.translationName}>{option.name}</Text>
              <Text style={styles.translationCode}>
                {option.code}
                {option.code === TRANSLATION_CODE ? ' · Recommended' : ''}
              </Text>
              {option.description ? (
                <Text style={styles.translationDescription}>{option.description}</Text>
              ) : null}
              <View style={styles.translationActions}>
                <TouchableOpacity
                  style={[
                    styles.translationButton,
                    status !== 'not_installed' && styles.translationButtonDisabled,
                  ]}
                  disabled={status !== 'not_installed'}
                  onPress={() => startImport(option)}
                >
                  <Text style={styles.translationButtonText}>{actionLabel}</Text>
                </TouchableOpacity>
                {status === 'installed' ? (
                  <TouchableOpacity
                    style={[styles.translationButton, styles.uninstallButton]}
                    onPress={() => uninstallTranslation(option)}
                  >
                    <Text style={styles.translationButtonText}>Uninstall</Text>
                  </TouchableOpacity>
                ) : null}
                {isActive ? <Text style={styles.translationActiveBadge}>Active</Text> : null}
              </View>
            </View>
          );
        })}
      </View>
    </ScrollView>
  );

  const renderBookPickerModal = () => {
    const bookIndexForStage = pickerBookIndex ?? 0;
    const stageBook = pickerBookIndex !== null ? BIBLE_BOOKS[pickerBookIndex] : null;
    const booksForTestament = pickerTestament === 'ot' ? oldTestamentBooks : newTestamentBooks;
    return (
      <Modal animationType="slide" transparent visible={isPickerVisible} onRequestClose={() => setPickerVisible(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <TouchableOpacity onPress={() => (stageBook ? setPickerBookIndex(null) : setPickerVisible(false))}>
                <Text style={styles.modalAction}>{stageBook ? 'Books' : 'Close'}</Text>
              </TouchableOpacity>
              <Text style={styles.modalTitle}>{stageBook ? stageBook.name : 'Choose a book'}</Text>
              <View style={{ width: 60 }} />
            </View>
            {stageBook ? (
              <View style={styles.chapterStage}>
                <ScrollView contentContainerStyle={styles.chapterGrid}>
                  {Array.from({ length: stageBook.chapters.length }).map((_, idx) => (
                    <TouchableOpacity
                      key={`${stageBook.name}-${idx + 1}`}
                      style={styles.chapterButton}
                      onPress={() => handleChapterSelect(bookIndexForStage, idx + 1)}
                    >
                      <Text style={styles.chapterButtonText}>{idx + 1}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            ) : (
              <View style={styles.bookStage}>
                <View style={styles.testamentSwitch}>
                  <TouchableOpacity
                    style={[
                      styles.testamentTab,
                      pickerTestament === 'ot' ? styles.testamentTabActive : styles.testamentTabInactive,
                    ]}
                    onPress={() => setPickerTestament('ot')}
                  >
                    <Text
                      style={[
                        styles.testamentTabText,
                        pickerTestament === 'ot' ? styles.testamentTabTextActive : styles.testamentTabTextInactive,
                      ]}
                    >
                      Old Testament
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.testamentTab,
                      pickerTestament === 'nt' ? styles.testamentTabActive : styles.testamentTabInactive,
                    ]}
                    onPress={() => setPickerTestament('nt')}
                  >
                    <Text
                      style={[
                        styles.testamentTabText,
                        pickerTestament === 'nt' ? styles.testamentTabTextActive : styles.testamentTabTextInactive,
                      ]}
                    >
                      New Testament
                    </Text>
                  </TouchableOpacity>
                </View>
                <View style={styles.bookListContainer}>
                  <View style={styles.bookListGrid}>
                    {booksForTestament.map(({ book, index }) => (
                      <TouchableOpacity
                        key={book.name}
                        style={styles.bookButton}
                        onPress={() => setPickerBookIndex(index)}
                      >
                        <Text style={styles.bookButtonText}>{book.name}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              </View>
            )}
          </View>
        </View>
      </Modal>
    );
  };

  const renderTranslationModal = () => {
    const hasInstalled = installedTranslations.length > 0;
    return (
      <Modal
        animationType="slide"
        transparent
        visible={isTranslationModalVisible}
        onRequestClose={closeTranslationModal}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <TouchableOpacity onPress={closeTranslationModal}>
                <Text style={styles.modalAction}>Close</Text>
              </TouchableOpacity>
              <Text style={styles.modalTitle}>Change translation</Text>
              <View style={{ width: 60 }} />
            </View>
            {hasInstalled ? (
              <ScrollView
                style={styles.translationModalScroll}
                contentContainerStyle={styles.translationModalList}
              >
                {installedTranslations.map((option) => {
                  const isActive = option.code === activeTranslationCode;
                  return (
                    <TouchableOpacity
                      key={option.code}
                      style={[
                        styles.translationModalOption,
                        isActive && styles.translationModalOptionActive,
                      ]}
                      onPress={() => handleSelectTranslation(option.code)}
                    >
                      <View>
                        <Text style={styles.translationModalName}>{option.name}</Text>
                        <Text style={styles.translationModalCode}>{option.code}</Text>
                      </View>
                      {isActive ? (
                        <Text style={styles.translationModalActiveBadge}>Active</Text>
                      ) : null}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            ) : (
              <View style={styles.translationModalEmpty}>
                <Text style={styles.translationModalEmptyText}>
                  You don't have any translations installed yet. Install one from Settings to begin.
                </Text>
              </View>
            )}
            <TouchableOpacity
              style={styles.manageTranslationsButton}
              onPress={handleManageTranslationsPress}
            >
              <Text style={styles.manageTranslationsButtonText}>Manage translations</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    );
  };

  const renderKardiaModal = () => {
    const reference = kardiaContext ? `${kardiaContext.book} ${kardiaContext.chapter}:${kardiaContext.verse}` : '';
    return (
      <Modal
        animationType="slide"
        transparent
        visible={isKardiaModalVisible}
        onRequestClose={closeKardiaModal}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <TouchableOpacity onPress={closeKardiaModal}>
                <Text style={styles.modalAction}>Close</Text>
              </TouchableOpacity>
              <Text style={styles.modalTitle}>Kardia translation</Text>
              <View style={{ width: 60 }} />
            </View>
            {reference ? <Text style={styles.kardiaModalReference}>{reference}</Text> : null}
            {kardiaStatus === 'loading' ? (
              <View style={styles.kardiaModalState}>
                <ActivityIndicator size="large" color="#333" />
                <Text style={styles.kardiaModalStateText}>Loading...</Text>
              </View>
            ) : null}
            {kardiaStatus === 'error' ? (
              <View style={styles.kardiaModalState}>
                <Text style={styles.errorText}>{kardiaError ?? 'Failed to load translation.'}</Text>
                <TouchableOpacity style={styles.button} onPress={retryKardiaTranslation}>
                  <Text style={styles.buttonText}>Retry</Text>
                </TouchableOpacity>
              </View>
            ) : null}
            {kardiaStatus === 'success' && kardiaRecord ? (
              <ScrollView style={styles.kardiaModalScroll} contentContainerStyle={styles.kardiaModalContent}>
                {effectiveSourceText ? (
                  <View style={styles.translationCard}>
                    <Text style={styles.translationCardLabel}>
                      {kardiaContext?.sourceTranslationCode ?? kardiaRecord.source_translation_code} · Original
                    </Text>
                    <Text style={styles.translationCardBody}>{effectiveSourceText}</Text>
                  </View>
                ) : null}
                <View style={styles.translationCard}>
                  <Text style={styles.translationCardLabel}>Kardia Translation</Text>
                  <Text style={styles.kardiaTranslationText}>
                    {effectiveKardiaText || 'No translation available yet.'}
                  </Text>
                </View>
                {hasKeyTermCard ? (
                  <View style={styles.translationCard}>
                    <Text style={styles.translationCardLabel}>Key Term</Text>
                    {effectiveKeyTerm?.term ? (
                      <Text style={styles.kardiaKeyTermTerm}>{effectiveKeyTerm.term}</Text>
                    ) : null}
                    {effectiveHebrewWord ? (
                      <Text style={styles.kardiaKeyTermHebrew}>{effectiveHebrewWord}</Text>
                    ) : null}
                  </View>
                ) : null}
                {hasInsights ? (
                  <View style={styles.translationCard}>
                    <Text style={styles.translationCardLabel}>Insights</Text>
                    {effectiveKeyTerm?.notes ? (
                      <View style={styles.insightBlock}>
                        <Text style={styles.insightTitle}>Notes</Text>
                        <Text style={styles.kardiaModalBodyText}>{effectiveKeyTerm.notes}</Text>
                      </View>
                    ) : null}
                    {effectiveHebrewCategory ? (
                      <View style={styles.insightBlock}>
                        <Text style={styles.insightTitle}>Hebrew Category</Text>
                        <Text style={styles.kardiaModalBodyText}>{effectiveHebrewCategory}</Text>
                      </View>
                    ) : null}
                    {effectiveWhyThisMatters ? (
                      <View style={styles.insightBlock}>
                        <Text style={styles.insightTitle}>Why this matters</Text>
                        <Text style={styles.kardiaModalBodyText}>{effectiveWhyThisMatters}</Text>
                      </View>
                    ) : null}
                    {effectiveExtraNotes.length > 0 ? (
                      <View style={styles.insightBlock}>
                        <Text style={styles.insightTitle}>Extra notes</Text>
                        {effectiveExtraNotes.map((note, index) => (
                          <Text key={`${note}-${index}`} style={styles.kardiaExtraNote}>
                            • {note}
                          </Text>
                        ))}
                      </View>
                    ) : null}
                  </View>
                ) : null}
              </ScrollView>
            ) : null}
          </View>
        </View>
      </Modal>
    );
  };

  if (phase === 'loading') {
    return (
      <View style={styles.centeredContent}>
        <ActivityIndicator size="large" color="#333" />
        <StatusBar style="dark" />
      </View>
    );
  }

  if (phase === 'error') {
    return (
      <View style={styles.centeredContent}>
        <Text style={styles.errorText}>{errorMessage}</Text>
        <TouchableOpacity style={styles.button} onPress={initialize}>
          <Text style={styles.buttonText}>Retry</Text>
        </TouchableOpacity>
        <StatusBar style="dark" />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <View style={styles.topNav}>
        {tabs.map((tab) => (
          <TouchableOpacity
            key={tab.key}
            style={[styles.navButton, currentTab === tab.key && styles.navButtonActive]}
            onPress={() => setCurrentTab(tab.key)}
          >
            <Text style={[styles.navButtonText, currentTab === tab.key && styles.navButtonTextActive]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      <View style={styles.contentArea}>
        {currentTab === 'home' && renderHome()}
        {currentTab === 'settings' && renderSettings()}
      </View>
      {renderBookPickerModal()}
      {renderTranslationModal()}
      {renderKardiaModal()}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#fff',
  },
  topNav: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  navButton: {
    flex: 1,
    paddingVertical: 14,
    alignItems: 'center',
  },
  navButtonActive: {
    borderBottomWidth: 2,
    borderBottomColor: '#111',
  },
  navButtonText: {
    fontSize: 14,
    color: '#888',
  },
  navButtonTextActive: {
    color: '#111',
    fontWeight: '600',
  },
  contentArea: {
    flex: 1,
    paddingHorizontal: 24,
    paddingVertical: 24,
  },
  settingsContent: {
    paddingBottom: 40,
  },
  settingsHeading: {
    fontSize: 18,
    fontWeight: '600',
    color: '#111',
    marginBottom: 6,
  },
  settingsDescription: {
    fontSize: 13,
    color: '#666',
    marginBottom: 16,
  },
  closeSettingsButton: {
    marginTop: 8,
    alignSelf: 'flex-start',
    paddingVertical: 10,
    paddingHorizontal: 24,
  },
  closeSettingsButtonText: {
    fontSize: 15,
    color: '#007aff',
    fontWeight: '600',
  },
  centeredContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
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
    marginTop: 16,
  },
  buttonText: {
    fontSize: 15,
    color: '#333',
  },
  readerContainer: {
    flex: 1,
  },
  readerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  navArrow: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  navArrowText: {
    fontSize: 24,
    color: '#111',
  },
  navArrowDisabled: {
    color: '#ccc',
  },
  readerTitle: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  readerTitleText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#111',
  },
  readerTitleCaret: {
    fontSize: 14,
    color: '#666',
    marginLeft: 4,
  },
  readerHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  translationPillButton: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 4,
    marginRight: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  translationPillText: {
    fontSize: 12,
    color: '#555',
  },
  translationPillCaret: {
    fontSize: 12,
    color: '#777',
    marginLeft: 4,
  },
  readerBody: {
    flex: 1,
  },
  readerLoading: {
    marginTop: 32,
  },
  chapterMessage: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 32,
  },
  verseListContent: {
    paddingBottom: 48,
  },
  verseRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  verseNumber: {
    fontSize: 12,
    color: '#999',
    marginRight: 6,
    marginTop: 2,
  },
  verseText: {
    flex: 1,
    fontSize: 16,
    lineHeight: 24,
    color: '#222',
  },
  importSection: {
    width: '100%',
    alignItems: 'center',
    marginTop: 24,
  },
  importingLabel: {
    fontSize: 15,
    color: '#444',
    marginBottom: 16,
    textAlign: 'center',
  },
  translationLabel: {
    fontSize: 14,
    color: '#666',
    marginBottom: 4,
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
    marginBottom: 16,
    textAlign: 'center',
  },
  translationList: {
    paddingBottom: 40,
  },
  translationItem: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
    backgroundColor: '#fafafa',
  },
  translationName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111',
  },
  translationCode: {
    fontSize: 13,
    color: '#555',
    marginTop: 4,
  },
  translationDescription: {
    fontSize: 12,
    color: '#777',
    marginTop: 6,
  },
  translationActions: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
  },
  translationButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#333',
    backgroundColor: '#fff',
  },
  translationButtonDisabled: {
    opacity: 0.5,
  },
  translationButtonText: {
    fontSize: 14,
    color: '#111',
  },
  uninstallButton: {
    borderColor: '#c33',
    marginLeft: 12,
  },
  translationActiveBadge: {
    marginLeft: 12,
    fontSize: 12,
    color: '#0a7',
    fontWeight: '600',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    backgroundColor: '#fff',
    height: '80%',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 24,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  modalAction: {
    color: '#007aff',
    fontSize: 14,
    width: 60,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111',
  },
  translationModalList: {
    paddingBottom: 16,
  },
  translationModalScroll: {
    flex: 1,
  },
  translationModalOption: {
    borderWidth: 1,
    borderColor: '#eee',
    borderRadius: 10,
    padding: 16,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  translationModalOptionActive: {
    borderColor: '#111',
  },
  translationModalName: {
    fontSize: 15,
    color: '#111',
    fontWeight: '600',
  },
  translationModalCode: {
    fontSize: 13,
    color: '#777',
    marginTop: 2,
  },
  translationModalActiveBadge: {
    fontSize: 12,
    color: '#0a7',
    fontWeight: '600',
  },
  translationModalEmpty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  translationModalEmptyText: {
    fontSize: 14,
    color: '#555',
    textAlign: 'center',
  },
  manageTranslationsButton: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#111',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  manageTranslationsButtonText: {
    fontSize: 15,
    color: '#111',
    fontWeight: '600',
  },
  kardiaModalReference: {
    fontSize: 14,
    color: '#555',
    marginBottom: 12,
  },
  kardiaModalState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  kardiaModalStateText: {
    marginTop: 12,
    fontSize: 15,
    color: '#555',
  },
  kardiaModalScroll: {
    flex: 1,
  },
  kardiaModalContent: {
    paddingBottom: 24,
  },
  translationCard: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#eee',
    marginBottom: 16,
    backgroundColor: '#fff',
  },
  translationCardLabel: {
    fontSize: 13,
    color: '#777',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 8,
  },
  translationCardBody: {
    fontSize: 16,
    lineHeight: 24,
    color: '#222',
  },
  kardiaTranslationText: {
    fontSize: 18,
    lineHeight: 26,
    color: '#111',
  },
  kardiaModalBodyText: {
    marginTop: 4,
    fontSize: 15,
    lineHeight: 22,
    color: '#333',
  },
  kardiaKeyTermTerm: {
    fontSize: 17,
    color: '#111',
    fontWeight: '600',
  },
  kardiaKeyTermHebrew: {
    fontSize: 16,
    color: '#333',
    marginTop: 4,
  },
  insightBlock: {
    marginTop: 12,
  },
  insightTitle: {
    fontSize: 13,
    color: '#666',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  kardiaExtraNote: {
    fontSize: 14,
    color: '#333',
    marginTop: 6,
    lineHeight: 20,
  },
  modalSectionLabel: {
    fontSize: 13,
    color: '#666',
    marginTop: 12,
    marginBottom: 8,
  },
  testamentSwitch: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    overflow: 'hidden',
    marginBottom: 12,
  },
  testamentTab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
  },
  testamentTabActive: {
    backgroundColor: '#f2f2f2',
  },
  testamentTabInactive: {
    backgroundColor: '#fff',
  },
  testamentTabText: {
    fontSize: 14,
  },
  testamentTabTextActive: {
    color: '#111',
    fontWeight: '600',
  },
  testamentTabTextInactive: {
    color: '#999',
  },
  bookListGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  bookListContainer: {
    flex: 1,
    width: '100%',
    justifyContent: 'flex-start',
  },
  bookButton: {
    width: '33.33%',
    paddingVertical: 8,
  },
  bookButtonText: {
    fontSize: 14,
    color: '#222',
  },
  chapterGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  chapterStage: {
    flex: 1,
    width: '100%',
  },
  bookStage: {
    flex: 1,
    width: '100%',
  },
  chapterButton: {
    width: '20%',
    paddingVertical: 12,
    alignItems: 'center',
  },
  chapterButtonText: {
    fontSize: 14,
    color: '#111',
  },
});

// UI 문자열 국제화 — {en, ko} 딕셔너리 + 모듈 레벨 언어 상태.
// view.ts 는 t(key) 로 호출하며, index.ts 에서 setLang/getLang 으로 언어를 관리한다.

const strings = {
  searchPlaceholder:   { en: "Search commands…",                    ko: "명령 검색…" },
  addButtonTitle:      { en: "Add command",                         ko: "명령 추가" },
  templatePlaceholder: { en: "Run template — {param} {{env}} `secret@key` …", ko: "실행 템플릿 — {param} {{env}} `secret@key` …" },
  labelFieldLabel:     { en: "Label",                               ko: "라벨" },
  labelFieldPlaceholder: { en: "e.g. Production deploy",            ko: "예: 프로덕션 배포" },
  templateFieldLabel:  { en: "Command template",                    ko: "명령 템플릿" },
  execTypeFieldLabel:  { en: "Execution type",                      ko: "실행 타입" },
  cancelButton:        { en: "Cancel",                              ko: "취소" },
  saveButton:          { en: "Save",                                ko: "저장" },
  emptySearch:         { en: "No results found",                    ko: "검색 결과가 없습니다" },
  emptyCommands:       { en: "No commands yet",                     ko: "아직 명령이 없습니다" },
  emptyCommandsHint:   { en: "Use + at top right to add your first command", ko: "오른쪽 위 + 로 첫 명령을 추가하세요" },
  runButtonTitle:      { en: "Run",                                 ko: "실행" },
  favoriteButtonTitle: { en: "Favorite",                            ko: "즐겨찾기" },
  editButtonTitle:     { en: "Edit",                                ko: "편집" },
  deleteButtonTitle:   { en: "Delete",                              ko: "삭제" },
  allGroups:           { en: "All groups",                          ko: "전체 그룹" },
} as const;

type StringKey = keyof typeof strings;

let _lang = "ko";

/** 현재 언어 설정. index.ts 에서 app.locale() + locale.changed 로 호출. */
export function setLang(lang: string): void {
  _lang = lang;
}

/** 현재 언어 반환. */
export function getLang(): string {
  return _lang;
}

/** 키로 번역 문자열 반환. 현재 lang 에 없으면 en 폴백. */
export function t(key: StringKey): string {
  const entry = strings[key] as Record<string, string>;
  return entry[_lang] ?? entry["en"];
}

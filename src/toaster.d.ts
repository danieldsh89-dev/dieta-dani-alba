/** Aviso breve de la app; con `undo`, muestra "↺ Deshacer" unos segundos. */
type Toaster = (text: string, undo?: () => void) => void;

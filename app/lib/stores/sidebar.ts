/**
 * Sidebar Store
 *
 * Global state for sidebar open/closed.
 * Used by both the header hamburger and the sidebar component.
 */

import { atom } from 'nanostores';

export const $sidebarOpen = atom<boolean>(false);

export function toggleSidebar(): void {
  $sidebarOpen.set(!$sidebarOpen.get());
}

export function openSidebar(): void {
  $sidebarOpen.set(true);
}

export function closeSidebar(): void {
  $sidebarOpen.set(false);
}

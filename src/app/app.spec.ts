import { TestBed } from '@angular/core/testing';
import { App } from './app';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should provide a skip link targeting the main content', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const skipLink = compiled.querySelector<HTMLAnchorElement>('.skip-link');
    expect(skipLink?.getAttribute('href')).toBe('#conteudo');
    expect(compiled.querySelector('main#conteudo')?.getAttribute('tabindex')).toBe('-1');
  });

  it('should keep features unavailable until their integrations exist', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector<HTMLInputElement>('input[type="search"]')?.disabled).toBe(true);
    const buttons = compiled.querySelectorAll<HTMLButtonElement>('.account-nav button');
    expect(buttons.length).toBe(2);
    for (const button of buttons) {
      expect(button.disabled).toBe(true);
      expect(button.getAttribute('aria-label')).toBeTruthy();
      expect(button.getAttribute('aria-describedby')).toBe('features-note');
    }
    expect(compiled.querySelector('#features-note')?.textContent).toContain('próximas etapas');
  });
});

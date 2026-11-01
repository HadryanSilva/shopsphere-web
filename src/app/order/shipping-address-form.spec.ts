import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ShippingAddressForm } from './shipping-address-form';
import { ShippingAddressRequest } from './order-api';

const address = {
  recipient: ' Destinatário ',
  addressLine: ' Rua, 1 ',
  addressLine2: ' Apartamento 2 ',
  city: ' Lisboa ',
  postalCode: ' 1000-001 ',
  countryCode: 'pt',
};

describe('ShippingAddressForm', () => {
  let fixture: ComponentFixture<ShippingAddressForm>;
  const emitted = vi.fn<(address: ShippingAddressRequest) => void>();
  function element() {
    return fixture.nativeElement as HTMLElement;
  }
  function input(field: keyof ShippingAddressRequest) {
    return element().querySelector<HTMLInputElement>(`input[name="${field}"]`)!;
  }
  function edit(field: keyof ShippingAddressRequest, value: string) {
    input(field).value = value;
    input(field).dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }
  function fill(values = address) {
    for (const field of Object.keys(values) as Array<keyof typeof values>)
      edit(field, values[field]);
  }
  async function submit() {
    const event = new Event('submit', { bubbles: true, cancelable: true });
    element().querySelector('form')!.dispatchEvent(event);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(event.defaultPrevented).toBe(true);
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ShippingAddressForm] }).compileComponents();
    fixture = TestBed.createComponent(ShippingAddressForm);
    emitted.mockClear();
    fixture.componentInstance.addressConfirmed.subscribe(emitted);
    fixture.detectChanges();
  });
  afterEach(() => vi.restoreAllMocks());

  it('starts empty with six labeled fields, autocomplete, native limits and no early errors', () => {
    expect(element().querySelector('form')?.hasAttribute('novalidate')).toBe(true);
    expect(element().querySelectorAll('input').length).toBe(6);
    const expected = [
      ['recipient', 150, 'shipping name'],
      ['addressLine', 200, 'shipping address-line1'],
      ['addressLine2', 200, 'shipping address-line2'],
      ['city', 100, 'shipping address-level2'],
      ['postalCode', 20, 'shipping postal-code'],
      ['countryCode', 2, 'shipping country'],
    ] as const;
    for (const [field, max, autocomplete] of expected) {
      const control = input(field);
      expect(control.value).toBe('');
      expect(control.maxLength).toBe(max);
      expect(control.required).toBe(field !== 'addressLine2');
      expect(control.getAttribute('autocomplete')).toBe(autocomplete);
      expect(
        element().querySelector(`label[for="${control.id}"]`)?.textContent?.trim(),
      ).toBeTruthy();
      expect(control.getAttribute('aria-invalid')).toBeNull();
    }
    expect(element().querySelector('[role="alert"]')).toBeNull();
    expect(emitted).not.toHaveBeenCalled();
  });

  it('focuses a linked summary of all required fields after an invalid confirmation', async () => {
    await submit();
    const summary = element().querySelector<HTMLElement>('.error-summary')!;
    expect(summary.querySelectorAll('a').length).toBe(5);
    expect(element().ownerDocument.activeElement).toBe(summary);
    for (const field of [
      'recipient',
      'addressLine',
      'city',
      'postalCode',
      'countryCode',
    ] as const) {
      const control = input(field);
      expect(control.getAttribute('aria-invalid')).toBe('true');
      const descriptions = control.getAttribute('aria-describedby')!.split(' ');
      const error = descriptions
        .map((id) => element().querySelector(`#${id}`))
        .find((node) => node?.classList.contains('field-error'));
      expect(error?.textContent).toContain('Preencha este campo');
    }
    expect(input('addressLine2').getAttribute('aria-invalid')).toBeNull();
    const link = summary.querySelector<HTMLAnchorElement>('a')!;
    link.click();
    expect(element().ownerDocument.activeElement).toBe(input('recipient'));
    expect(emitted).not.toHaveBeenCalled();
  });

  it('shows a touched field error without marking unrelated fields or announcing a summary', () => {
    input('recipient').dispatchEvent(new Event('blur'));
    fixture.detectChanges();
    expect(input('recipient').getAttribute('aria-invalid')).toBe('true');
    expect(input('city').getAttribute('aria-invalid')).toBeNull();
    expect(element().querySelector('.error-summary')).toBeNull();
    edit('recipient', 'Nome');
    expect(input('recipient').getAttribute('aria-invalid')).toBeNull();
  });

  it('normalizes only the emitted address without HTTP, UUID generation or storage', async () => {
    const write = vi.spyOn(Storage.prototype, 'setItem');
    const uuid = vi.spyOn(element().ownerDocument.defaultView!.crypto, 'randomUUID');
    fill();
    await submit();
    expect(emitted).toHaveBeenCalledExactlyOnceWith({
      recipient: 'Destinatário',
      addressLine: 'Rua, 1',
      addressLine2: 'Apartamento 2',
      city: 'Lisboa',
      postalCode: '1000-001',
      countryCode: 'PT',
    });
    expect(input('recipient').value).toBe(' Destinatário ');
    expect(write).not.toHaveBeenCalled();
    expect(uuid).not.toHaveBeenCalled();
    expect(element().querySelector('.error-summary')).toBeNull();
  });

  it.each(['', '   '])('maps optional blank complement %j to null', async (complement) => {
    fill({ ...address, addressLine2: complement });
    await submit();
    expect(emitted).toHaveBeenCalledWith(expect.objectContaining({ addressLine2: null }));
  });

  it.each(['recipient', 'addressLine', 'city', 'postalCode', 'countryCode'] as const)(
    'rejects whitespace-only required field %s',
    async (field) => {
      fill();
      edit(field, '   ');
      await submit();
      expect(emitted).not.toHaveBeenCalled();
      expect(input(field).getAttribute('aria-invalid')).toBe('true');
    },
  );

  it('accepts all maximum lengths and preserves non-Portuguese postal formats', async () => {
    fill({
      recipient: 'x'.repeat(150),
      addressLine: 'x'.repeat(200),
      addressLine2: 'x'.repeat(200),
      city: 'x'.repeat(100),
      postalCode: 'x'.repeat(20),
      countryCode: 'GB',
    });
    await submit();
    expect(emitted).toHaveBeenCalledOnce();
    edit('postalCode', 'SW1A 1AA');
    await submit();
    expect(emitted).toHaveBeenLastCalledWith(
      expect.objectContaining({ postalCode: 'SW1A 1AA', countryCode: 'GB' }),
    );
  });

  it.each([
    ['recipient', 151],
    ['addressLine', 201],
    ['addressLine2', 201],
    ['city', 101],
    ['postalCode', 21],
  ] as const)(
    'rejects %s beyond its limit even if browser maxlength is bypassed',
    async (field, length) => {
      fill();
      edit(field, 'x'.repeat(length));
      await submit();
      expect(emitted).not.toHaveBeenCalled();
      expect(input(field).getAttribute('aria-invalid')).toBe('true');
      expect(element().querySelector('.field-error')?.textContent).toContain(
        `no máximo ${length - 1}`,
      );
    },
  );

  it.each(['P', 'PRT', '12', 'P1', 'P-', 'éé'])(
    'rejects country code %s without assuming a country list',
    async (country) => {
      fill({ ...address, countryCode: country });
      await submit();
      expect(emitted).not.toHaveBeenCalled();
      expect(input('countryCode').getAttribute('aria-invalid')).toBe('true');
    },
  );

  it('removes corrected errors and emits only after a new explicit confirmation', async () => {
    await submit();
    fill();
    expect(element().querySelector('.error-summary')).toBeNull();
    expect(element().querySelector('[aria-invalid="true"]')).toBeNull();
    expect(emitted).not.toHaveBeenCalled();
    await submit();
    expect(emitted).toHaveBeenCalledOnce();
  });

  it('does not steal focus during editing after an invalid confirmation', async () => {
    fill();
    edit('city', '');
    await submit();
    input('city').focus();
    edit('city', 'L');
    await fixture.whenStable();
    edit('city', '');
    await fixture.whenStable();
    expect(element().ownerDocument.activeElement).toBe(input('city'));
    expect(emitted).not.toHaveBeenCalled();
  });

  it('disables all controls and ignores synthetic editing and confirmation while disabled', async () => {
    fill();
    fixture.componentRef.setInput('disabled', true);
    fixture.detectChanges();
    expect(element().querySelector<HTMLFieldSetElement>('fieldset')?.disabled).toBe(true);
    expect(element().querySelector('button')?.matches(':disabled')).toBe(true);
    edit('city', 'Porto');
    await submit();
    expect(emitted).not.toHaveBeenCalled();
    fixture.componentRef.setInput('disabled', false);
    fixture.detectChanges();
    await submit();
    expect(emitted).toHaveBeenCalledWith(expect.objectContaining({ city: 'Lisboa' }));
  });

  it('supports a parent-supplied action label and separate address objects per confirmation', async () => {
    fixture.componentRef.setInput('submitLabel', 'Rever endereço');
    fixture.detectChanges();
    expect(element().querySelector('button')?.textContent?.trim()).toBe('Rever endereço');
    fill();
    await submit();
    const first = emitted.mock.calls[0][0] as ShippingAddressRequest;
    first.city = 'Mutação externa';
    await submit();
    expect(emitted).toHaveBeenLastCalledWith(expect.objectContaining({ city: 'Lisboa' }));
  });

  it('can disable only confirmation while allowing the address to be edited', async () => {
    fixture.componentRef.setInput('submitDisabled', true);
    fixture.detectChanges();
    fill();
    expect(input('city').matches(':disabled')).toBe(false);
    expect(element().querySelector<HTMLButtonElement>('button')?.disabled).toBe(true);
    await submit();
    expect(emitted).not.toHaveBeenCalled();
    fixture.componentRef.setInput('submitDisabled', false);
    fixture.detectChanges();
    await submit();
    expect(emitted).toHaveBeenCalledWith(expect.objectContaining({ city: 'Lisboa' }));
  });

  it('uses unique labels and description IDs when two forms are rendered', () => {
    const other = TestBed.createComponent(ShippingAddressForm);
    other.detectChanges();
    const firstIds = Array.from(element().querySelectorAll('[id]')).map((node) => node.id);
    const otherIds = Array.from((other.nativeElement as HTMLElement).querySelectorAll('[id]')).map(
      (node) => node.id,
    );
    expect(firstIds.some((id) => otherIds.includes(id))).toBe(false);
    other.destroy();
  });
});

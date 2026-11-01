import {
  afterNextRender,
  Component,
  computed,
  ElementRef,
  inject,
  Injector,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { ShippingAddressRequest } from './order-api';

type FieldName = keyof ShippingAddressRequest;
let nextFormId = 0;

const fields: ReadonlyArray<{
  name: FieldName;
  label: string;
  max: number;
  autocomplete: string;
  optional?: boolean;
  hint?: string;
}> = [
  { name: 'recipient', label: 'Destinatário', max: 150, autocomplete: 'shipping name' },
  { name: 'addressLine', label: 'Rua e número', max: 200, autocomplete: 'shipping address-line1' },
  {
    name: 'addressLine2',
    label: 'Complemento (opcional)',
    max: 200,
    autocomplete: 'shipping address-line2',
    optional: true,
  },
  { name: 'city', label: 'Cidade', max: 100, autocomplete: 'shipping address-level2' },
  {
    name: 'postalCode',
    label: 'Código postal',
    max: 20,
    autocomplete: 'shipping postal-code',
    hint: 'Use o formato do seu país, com até 20 caracteres.',
  },
  {
    name: 'countryCode',
    label: 'Código do país',
    max: 2,
    autocomplete: 'shipping country',
    hint: 'Indique duas letras, por exemplo PT.',
  },
];

@Component({
  selector: 'app-shipping-address-form',
  templateUrl: './shipping-address-form.html',
  styleUrl: './shipping-address-form.scss',
})
export class ShippingAddressForm {
  readonly disabled = input(false);
  readonly submitLabel = input('Confirmar endereço');
  readonly addressConfirmed = output<ShippingAddressRequest>();
  protected readonly fields = fields;
  protected readonly prefix = `shipping-address-${++nextFormId}`;
  private readonly injector = inject(Injector);
  private readonly summary = viewChild<ElementRef<HTMLElement>>('summary');
  protected readonly values = signal<Record<FieldName, string>>({
    recipient: '',
    addressLine: '',
    addressLine2: '',
    city: '',
    postalCode: '',
    countryCode: '',
  });
  protected readonly submitted = signal(false);
  private readonly touched = signal<ReadonlySet<FieldName>>(new Set());
  private readonly normalized = computed<ShippingAddressRequest>(() => {
    const value = this.values();
    return {
      recipient: value.recipient.trim(),
      addressLine: value.addressLine.trim(),
      addressLine2: value.addressLine2.trim() || null,
      city: value.city.trim(),
      postalCode: value.postalCode.trim(),
      countryCode: value.countryCode.trim().toUpperCase(),
    };
  });
  protected readonly errors = computed(() => {
    const address = this.normalized();
    const errors: Partial<Record<FieldName, string>> = {};
    for (const field of fields) {
      const value = address[field.name];
      if (!field.optional && !value) errors[field.name] = 'Preencha este campo.';
      else if (field.name === 'countryCode' && !/^[A-Z]{2}$/.test(value ?? '')) {
        errors[field.name] = 'Indique duas letras para o código do país.';
      } else if (value && value.length > field.max) {
        errors[field.name] = `Use no máximo ${field.max} caracteres.`;
      }
    }
    return errors;
  });
  protected readonly invalidFields = computed(() =>
    fields.filter((field) => !!this.errors()[field.name]),
  );

  protected edit(field: FieldName, event: Event) {
    if (this.disabled()) return;
    this.values.update((value) => ({
      ...value,
      [field]: (event.target as HTMLInputElement).value,
    }));
  }

  protected touch(field: FieldName) {
    if (!this.disabled()) this.touched.update((value) => new Set([...value, field]));
  }

  protected error(field: FieldName): string | undefined {
    return this.submitted() || this.touched().has(field) ? this.errors()[field] : undefined;
  }

  protected describedBy(field: FieldName): string | null {
    const ids = [];
    if (fields.find((item) => item.name === field)?.hint) ids.push(`${this.prefix}-${field}-hint`);
    if (this.error(field)) ids.push(`${this.prefix}-${field}-error`);
    return ids.join(' ') || null;
  }

  protected confirm(event: Event) {
    event.preventDefault();
    if (this.disabled()) return;
    this.submitted.set(true);
    if (this.invalidFields().length) {
      afterNextRender(() => this.summary()?.nativeElement.focus(), { injector: this.injector });
      return;
    }
    this.addressConfirmed.emit({ ...this.normalized() });
  }

  protected focusField(field: FieldName, event: Event) {
    event.preventDefault();
    this.summary()?.nativeElement.ownerDocument.getElementById(`${this.prefix}-${field}`)?.focus();
  }
}

export const CHECKOUT_INFO = {
  VALID: {
    firstName: 'John',
    lastName: 'Doe',
    zipCode: '92101',
  },
  MISSING_FIRST_NAME: {
    firstName: '',
    lastName: 'Doe',
    zipCode: '92101',
  },
  MISSING_LAST_NAME: {
    firstName: 'John',
    lastName: '',
    zipCode: '92101',
  },
  MISSING_ZIP: {
    firstName: 'John',
    lastName: 'Doe',
    zipCode: '',
  },
} as const;

export const CHECKOUT_ERRORS = {
  MISSING_FIRST_NAME: 'Error: First Name is required',
  MISSING_LAST_NAME: 'Error: Last Name is required',
  MISSING_ZIP: 'Error: Postal Code is required',
} as const;

export const PRODUCTS = {
  BACKPACK: {
    name: 'Sauce Labs Backpack',
    dataTestId: 'sauce-labs-backpack',
    price: '$29.99',
  },
  BIKE_LIGHT: {
    name: 'Sauce Labs Bike Light',
    dataTestId: 'sauce-labs-bike-light',
    price: '$9.99',
  },
  BOLT_TSHIRT: {
    name: 'Sauce Labs Bolt T-Shirt',
    dataTestId: 'sauce-labs-bolt-t-shirt',
    price: '$15.99',
  },
  FLEECE_JACKET: {
    name: 'Sauce Labs Fleece Jacket',
    dataTestId: 'sauce-labs-fleece-jacket',
    price: '$49.99',
  },
  ONESIE: {
    name: 'Sauce Labs Onesie',
    dataTestId: 'sauce-labs-onesie',
    price: '$7.99',
  },
} as const;

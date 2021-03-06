/**
 * @module ember-paper
 */
import Ember from 'ember';
import { promiseArray } from 'ember-paper/utils/promise-proxies';

const {
  Component,
  inject,
  computed,
  String: { fmt },
  observer,
  run,
  get,
  isArray,
  A,
  assert,
  isPresent
} = Ember;

function isString(item) {
  return typeof item === 'string' || item instanceof String;
}

/**
 * Provides material design autocomplete.
 *
 * ## Dependencies
 * - paper-autocomplete-item
 * - paper-autocomplete-list
 * - paper-input
 * - paper-button
 * - input
 *
 * @class PaperAutoComplete
 * @extends Ember.Component
 */
export default Component.extend({
  util: inject.service(),
  constants: inject.service(),

  tagName: 'md-autocomplete',
  classNameBindings: ['notFloating:md-default-theme'],
  attributeBindings: ['floating:md-floating-label', 'showDisabled:disabled'],

  // Internal
  hidden: true,
  selectedIndex: 0,
  messages: [],
  noBlur: false,
  hasFocus: false,
  searchText: '',
  // wrap in a computed property so that cache
  // isn't shared among autocomplete instances
  itemCache: computed(function() {
    return {};
  }),

  // Public
  disabled: null,
  required: null,
  lookupKey: null,
  placeholder: '',
  delay: 0,
  minLength: 1,
  allowNonExisting: false,
  noCache: false,
  notFoundMessage: 'No matches found for \'%@\'.',

  init() {
    this._super(...arguments);

    if (this.get('model')) {
      this.set('searchText', this.lookupLabelOfItem(this.get('model')));
      this.searchTextDidChange();
    }
  },

  notFloating: computed.not('floating'),
  notHidden: computed.not('hidden'),

  autocompleteWrapperId: computed('elementId', function() {
    return `autocomplete-wrapper-${this.get('elementId')}`;
  }),

  sections: {
    itemTemplate: { isItemTemplate: true },
    notFoundTemplate: { isNotFoundTemplate: true }
  },

  notFoundMsg: computed('searchText', 'notFoundMessage', function() {
    return fmt(this.get('notFoundMessage'), [this.get('searchText')]);
  }),

  /*
   * Needed because of false = disabled='false'.
   */
  showDisabled: computed('disabled', function() {
    if (this.get('disabled')) {
      return true;
    }
  }),

  showLoadingBar: computed('loading', 'allowNonExisting', 'debouncingState', function() {
    return !this.get('loading') && !this.get('allowNonExisting') && !this.get('debouncingState');
  }),

  enableClearButton: computed('searchText', 'disabled', function() {
    return this.get('searchText') && !this.get('disabled');
  }),

  /*
   * Source filtering logic
   */
  searchTextDidChange: observer('searchText', function() {
    let searchText = this.get('searchText');
    if (searchText !== this.get('previousSearchText')) {
      if (!this.get('allowNonExisting')) {
        this.set('model', null);
      } else {
        this.set('model', searchText);
      }

      this.sendAction('update-filter', searchText);

      this.set('debouncingState', true);
      run.debounce(this, this.setDebouncedSearchText, this.get('delay'));
      this.set('previousSearchText', searchText);
    }
  }),

  modelDidChange: observer('model', function() {
    let model = this.get('model');
    let value = this.lookupLabelOfItem(model);
    // First set previousSearchText then searchText ( do not trigger observer only update value! ).
    this.set('previousSearchText', value);
    this.set('searchText', value);
    this.set('hidden', true);
  }),

  setDebouncedSearchText() {
    let searchText = this.get('searchText');
    if (this.get('isMinLengthMet')) {
      this.sendAction('debounced-update-filter', searchText);
      if (!this.cacheGet(searchText)) {
        this.sendAction('cache-miss', searchText);
      } else {
        this.sendAction('cache-hit', searchText);
      }
      this.set('debouncedSearchText', searchText);

      // If the autocomplete is being triggered by a human / not on initial render.
      if (this.get('hasFocus') || this.get('noBlur')) {
        this.set('hidden', false);
      }
    } else {
      this.set('hidden', true);
    }
    this.set('debouncingState', false);
  },

  loading: computed.bool('sourcePromiseArray.isPending').readOnly(),

  // coalesces all promises into PromiseArrays or Arrays
  sourcePromiseArray: computed('source', function() {
    let source = this.get('source');
    if (source && source.then) {
      // coalesce into promise array
      return promiseArray(source);
    } else if (isArray(source)) {
      // return array
      return A(source);
    } else {
      // Unknown source type
      assert('The provided \'source\' for paper-autocomplete must be an Array or a Promise.', !isPresent(source));
      return A();
    }
  }).readOnly(),

  suggestions: computed('debouncedSearchText', 'sourcePromiseArray.[]', function() {
    let source = this.get('sourcePromiseArray');
    let lookupKey = this.get('lookupKey');
    let searchText = (this.get('debouncedSearchText') || '').toLowerCase();
    let cachedItems = this.cacheGet(searchText);
    let suggestions;

    if (cachedItems) {
      // We have cached results
      suggestions = cachedItems;
    } else {
      // no cache

      let data = this.filterArray(source, searchText, lookupKey);
      if (source.then && source.get('isFulfilled')) {
        // cache when we have a PromiseArray
        this.cacheSet(searchText, data);
      }
      suggestions = A(data);
    }
    // If we have no item suggestions, and allowNonExisting is enabled
    // We need to close the paper-autocomplete-list so all mouse events get activated again.
    if (suggestions.length === 0 && this.get('allowNonExisting')) {
      this.set('hidden', true);
    }
    return suggestions;
  }).readOnly(),

  filterArray(array, searchText, lookupKey) {
    return array.filter(function(item) {
      assert(`You have not defined \`lookupKey\` on paper-autocomplete, when source contained
        items that are not of type String. To fix this error provide a
        lookupKey=\`key to lookup from source item\`.`, isString(item) || isPresent(lookupKey));

      assert(`You specified \`lookupKey\` as a lookupKey on paper-autocomplete,
        but at least one of its values is not of type String. To fix this error make sure that every \`lookupKey\`
        value is a string.`, isString(item) || (isPresent(lookupKey) && isString(get(item, lookupKey))));

      let search = isString(item) ? item.toLowerCase() : get(item, lookupKey).toLowerCase();
      return search.indexOf(searchText) === 0;
    });
  },

  // TODO move cache to service? Components are not singletons.
  cacheGet(text) {
    return !this.get('noCache') && this.get('itemCache')[text];
  },

  cacheSet(text, data) {
    this.get('itemCache')[text] = data;
  },

  shouldHide: computed.not('isMinLengthMet'),

  isMinLengthMet: computed('searchText', 'minLength', function() {
    return this.get('searchText').length >= this.get('minLength');
  }),

  /*
   * Returns the default index based on whether or not autoselect is enabled.
   * @returns {number}
   */
  defaultIndex: computed('autoselect', function() {
    return this.get('autoselect') ? 0 : -1;
  }),

  lookupLabelOfItem(model) {
    return this.get('lookupKey') ? get(model, this.get('lookupKey')) : model;
  },

  actions: {
    clear() {
      this.set('searchText', '');
      this.set('selectedIndex', -1);
      this.set('model', null);
      this.set('hidden', this.get('shouldHide'));
    },

    pickModel(model) {
      this.set('model', model);
      let value = this.lookupLabelOfItem(model);
      // First set previousSearchText then searchText ( do not trigger observer only update value! ).
      this.set('previousSearchText', value);
      this.set('searchText', value);
      this.set('hidden', true);
    },

    inputFocusOut() {
      this.set('hasFocus', false);
      if (this.get('noBlur') === false) {
        this.set('hidden', true);
      }
    },

    inputFocusIn() {
      this.set('hasFocus', true);
      this.set('hidden', this.get('shouldHide'));
    },

    inputKeyDown(value, event) {
      switch (event.keyCode) {
        case this.get('constants').KEYCODE.DOWN_ARROW:
          if (this.get('loading')) {
            return;
          }
          this.set('selectedIndex', Math.min(this.get('selectedIndex') + 1, this.get('suggestions').length - 1));
          break;
        case this.get('constants').KEYCODE.UP_ARROW:
          if (this.get('loading')) {
            return;
          }
          this.set('selectedIndex', this.get('selectedIndex') < 0 ? this.get('suggestions').length - 1 : Math.max(0, this.get('selectedIndex') - 1));
          break;
        case this.get('constants').KEYCODE.TAB:
        case this.get('constants').KEYCODE.ENTER:
          if (this.get('hidden') || this.get('loading') || this.get('selectedIndex') < 0 || this.get('suggestions').length < 1) {
            return;
          }
          this.send('pickModel', this.get('suggestions').objectAt(this.get('selectedIndex')));
          break;
        case this.get('constants').KEYCODE.ESCAPE:
          this.set('searchText', '');
          this.set('selectedIndex', this.get('defaultIndex'));
          this.set('model', null);
          this.set('hidden', this.get('shouldHide'));
          break;
        default:
          break;
      }
    },

    listMouseEnter() {
      this.set('noBlur', true);
    },

    listMouseLeave() {
      this.set('noBlur', false);
      if (this.get('hasFocus') === false) {
        this.set('hidden', true);
      }
    },

    listMouseUp() {
      this.$().find('input').focus();
    }
  }

});

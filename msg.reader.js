/* Copyright 2016 Yury Karpovich
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
/*
 MSG Reader
 */

if (!DataStream) {
  const DataStream = require('./DataStream');
}

// constants
const CONST = {
  FILE_HEADER: uInt2int([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]),
  MSG: {
    UNUSED_BLOCK: -1,
    END_OF_CHAIN: -2,

    S_BIG_BLOCK_SIZE: 0x0200,
    S_BIG_BLOCK_MARK: 9,

    L_BIG_BLOCK_SIZE: 0x1000,
    L_BIG_BLOCK_MARK: 12,

    SMALL_BLOCK_SIZE: 0x0040,
    BIG_BLOCK_MIN_DOC_SIZE: 0x1000,
    HEADER: {
      PROPERTY_START_OFFSET: 0x30,

      BAT_START_OFFSET: 0x4c,
      BAT_COUNT_OFFSET: 0x2C,

      SBAT_START_OFFSET: 0x3C,
      SBAT_COUNT_OFFSET: 0x40,

      XBAT_START_OFFSET: 0x44,
      XBAT_COUNT_OFFSET: 0x48
    },
    PROP: {
      NO_INDEX: -1,
      PROPERTY_SIZE: 0x0080,

      NAME_SIZE_OFFSET: 0x40,
      MAX_NAME_LENGTH: (/*NAME_SIZE_OFFSET*/0x40 / 2) - 1,
      TYPE_OFFSET: 0x42,
      PREVIOUS_PROPERTY_OFFSET: 0x44,
      NEXT_PROPERTY_OFFSET: 0x48,
      CHILD_PROPERTY_OFFSET: 0x4C,
      START_BLOCK_OFFSET: 0x74,
      SIZE_OFFSET: 0x78,
      TYPE_ENUM: {
        DIRECTORY: 1,
        DOCUMENT: 2,
        ROOT: 5
      }
    },
    FIELD: {
      PREFIX: {
        ATTACHMENT: '__attach_version1.0',
        RECIPIENT: '__recip_version1.0',
        DOCUMENT: '__substg1.'
      },
      // example (use fields as needed)
      NAME_MAPPING: {
        // email specific
        '0037': 'subject',
        '0c1a': 'senderName',
        '5d02': 'senderEmail',
        '1000': 'body',
        '007d': 'headers',
        // attachment specific
        '3703': 'extension',
        '3704': 'fileNameShort',
        '3707': 'fileName',
        '3712': 'pidContentId',
        // recipient specific
        '3001': 'name',
        '39fe': 'email'
      },
      CLASS_MAPPING: {
        ATTACHMENT_DATA: '3701'
      },
      TYPE_MAPPING: {
        '001e': 'string',
        '001f': 'unicode',
        '0102': 'binary'
      },
      DIR_TYPE: {
        INNER_MSG: '000d'
      }
    }
  }
};

// unit utils
function arraysEqual(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (a.length != b.length) return false;

  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function uInt2int(data) {
  const result = new Array(data.length);
  for (let i = 0; i < data.length; i++) {
    result[i] = data[i] << 24 >> 24;
  }
  return result;
}

// MSG Reader implementation

// check MSG file header
function isMSGFile(ds) {
  ds.seek(0);
  return arraysEqual(CONST.FILE_HEADER, ds.readInt8Array(CONST.FILE_HEADER.length));
}

// FAT utils
function getBlockOffsetAt(msgData, offset) {
  return (offset + 1) * msgData.bigBlockSize;
}

function getBlockAt(ds, msgData, offset) {
  let startOffset = getBlockOffsetAt(msgData, offset);
  ds.seek(startOffset);
  return ds.readInt32Array(msgData.bigBlockLength);
}

function getNextBlockInner(ds, msgData, offset, blockOffsetData) {
  let currentBlock = Math.floor(offset / msgData.bigBlockLength);
  let currentBlockIndex = offset % msgData.bigBlockLength;

  let startBlockOffset = blockOffsetData[currentBlock];

  return getBlockAt(ds, msgData, startBlockOffset)[currentBlockIndex];
}

function getNextBlock(ds, msgData, offset) {
  return getNextBlockInner(ds, msgData, offset, msgData.batData);
}

function getNextBlockSmall(ds, msgData, offset) {
  return getNextBlockInner(ds, msgData, offset, msgData.sbatData);
}

// convert binary data to dictionary
function parseMsgData(ds) {
  let msgData = headerData(ds);
  msgData.batData = batData(ds, msgData);
  msgData.sbatData = sbatData(ds, msgData);
  if (msgData.xbatCount > 0) {
    xbatData(ds, msgData);
  }
  msgData.propertyData = propertyData(ds, msgData);
  msgData.fieldsData = fieldsData(ds, msgData);

  return msgData;
}

// extract header data
function headerData(ds) {
  let headerData = {};

  // system data
  headerData.bigBlockSize =
    ds.readByte(/*const position*/30) == CONST.MSG.L_BIG_BLOCK_MARK ? CONST.MSG.L_BIG_BLOCK_SIZE : CONST.MSG.S_BIG_BLOCK_SIZE;
  headerData.bigBlockLength = headerData.bigBlockSize / 4;
  headerData.xBlockLength = headerData.bigBlockLength - 1;

  // header data
  headerData.batCount = ds.readInt(CONST.MSG.HEADER.BAT_COUNT_OFFSET);
  headerData.propertyStart = ds.readInt(CONST.MSG.HEADER.PROPERTY_START_OFFSET);
  headerData.sbatStart = ds.readInt(CONST.MSG.HEADER.SBAT_START_OFFSET);
  headerData.sbatCount = ds.readInt(CONST.MSG.HEADER.SBAT_COUNT_OFFSET);
  headerData.xbatStart = ds.readInt(CONST.MSG.HEADER.XBAT_START_OFFSET);
  headerData.xbatCount = ds.readInt(CONST.MSG.HEADER.XBAT_COUNT_OFFSET);

  return headerData;
}

function batCountInHeader(msgData) {
  let maxBatsInHeader = (CONST.MSG.S_BIG_BLOCK_SIZE - CONST.MSG.HEADER.BAT_START_OFFSET) / 4;
  return Math.min(msgData.batCount, maxBatsInHeader);
}

function batData(ds, msgData) {
  let result = new Array(batCountInHeader(msgData));
  ds.seek(CONST.MSG.HEADER.BAT_START_OFFSET);
  for (let i = 0; i < result.length; i++) {
    result[i] = ds.readInt32()
  }
  return result;
}

function sbatData(ds, msgData) {
  let result = [];
  let startIndex = msgData.sbatStart;

  for (let i = 0; i < msgData.sbatCount && startIndex != CONST.MSG.END_OF_CHAIN; i++) {
    result.push(startIndex);
    startIndex = getNextBlock(ds, msgData, startIndex);
  }
  return result;
}

function xbatData(ds, msgData) {
  let batCount = batCountInHeader(msgData);
  let batCountTotal = msgData.batCount;
  let remainingBlocks = batCountTotal - batCount;

  let nextBlockAt = msgData.xbatStart;
  for (let i = 0; i < msgData.xbatCount; i++) {
    let xBatBlock = getBlockAt(ds, msgData, nextBlockAt);
    nextBlockAt = xBatBlock[msgData.xBlockLength];

    let blocksToProcess = Math.min(remainingBlocks, msgData.xBlockLength);
    for (let j = 0; j < blocksToProcess; j++) {
      let blockStartAt = xBatBlock[j];
      if (blockStartAt == CONST.MSG.UNUSED_BLOCK || blockStartAt == CONST.MSG.END_OF_CHAIN) {
        break;
      }
      msgData.batData.push(blockStartAt);
    }
    remainingBlocks -= blocksToProcess;
  }
}

// extract property data and property hierarchy
function propertyData(ds, msgData) {
  let props = [];

  let currentOffset = msgData.propertyStart;

  while (currentOffset != CONST.MSG.END_OF_CHAIN) {
    convertBlockToProperties(ds, msgData, currentOffset, props);
    currentOffset = getNextBlock(ds, msgData, currentOffset);
  }
  createPropertyHierarchy(props, /*property with index 0 (zero) always as root*/props[0]);
  return props;
}

function convertName(ds, offset) {
  let nameLength = ds.readShort(offset + CONST.MSG.PROP.NAME_SIZE_OFFSET);
  if (nameLength < 1) {
    return '';
  } else {
    return ds.readStringAt(offset, nameLength / 2);
  }
}

function convertProperty(ds, index, offset) {
  return {
    index: index,
    type: ds.readByte(offset + CONST.MSG.PROP.TYPE_OFFSET),
    name: convertName(ds, offset),
    // hierarchy
    previousProperty: ds.readInt(offset + CONST.MSG.PROP.PREVIOUS_PROPERTY_OFFSET),
    nextProperty: ds.readInt(offset + CONST.MSG.PROP.NEXT_PROPERTY_OFFSET),
    childProperty: ds.readInt(offset + CONST.MSG.PROP.CHILD_PROPERTY_OFFSET),
    // data offset
    startBlock: ds.readInt(offset + CONST.MSG.PROP.START_BLOCK_OFFSET),
    sizeBlock: ds.readInt(offset + CONST.MSG.PROP.SIZE_OFFSET)
  };
}

function convertBlockToProperties(ds, msgData, propertyBlockOffset, props) {

  let propertyCount = msgData.bigBlockSize / CONST.MSG.PROP.PROPERTY_SIZE;
  let propertyOffset = getBlockOffsetAt(msgData, propertyBlockOffset);

  for (let i = 0; i < propertyCount; i++) {
    let propertyType = ds.readByte(propertyOffset + CONST.MSG.PROP.TYPE_OFFSET);
    switch (propertyType) {
      case CONST.MSG.PROP.TYPE_ENUM.ROOT:
      case CONST.MSG.PROP.TYPE_ENUM.DIRECTORY:
      case CONST.MSG.PROP.TYPE_ENUM.DOCUMENT:
        props.push(convertProperty(ds, props.length, propertyOffset));
        break;
      default:
        /* unknown property types */
        props.push(null);
    }

    propertyOffset += CONST.MSG.PROP.PROPERTY_SIZE;
  }
}

function createPropertyHierarchy(props, nodeProperty) {

  if (nodeProperty.childProperty == CONST.MSG.PROP.NO_INDEX) {
    return;
  }
  nodeProperty.children = [];

  let children = [nodeProperty.childProperty];
  while (children.length != 0) {
    let currentIndex = children.shift();
    let current = props[currentIndex];
    if (current == null) {
      continue;
    }
    nodeProperty.children.push(currentIndex);

    if (current.type == CONST.MSG.PROP.TYPE_ENUM.DIRECTORY) {
      createPropertyHierarchy(props, current);
    }
    if (current.previousProperty != CONST.MSG.PROP.NO_INDEX) {
      children.push(current.previousProperty);
    }
    if (current.nextProperty != CONST.MSG.PROP.NO_INDEX) {
      children.push(current.nextProperty);
    }
  }
}

// extract real fields
function fieldsData(ds, msgData) {
  let fields = {
    attachments: [],
    recipients: []
  };
  fieldsDataDir(ds, msgData, msgData.propertyData[0], fields);
  return fields;
}

function fieldsDataDir(ds, msgData, dirProperty, fields) {

  if (dirProperty.children && dirProperty.children.length > 0) {
    for (let i = 0; i < dirProperty.children.length; i++) {
      let childProperty = msgData.propertyData[dirProperty.children[i]];

      if (childProperty.type == CONST.MSG.PROP.TYPE_ENUM.DIRECTORY) {
        fieldsDataDirInner(ds, msgData, childProperty, fields)
      } else if (childProperty.type == CONST.MSG.PROP.TYPE_ENUM.DOCUMENT
        && childProperty.name.indexOf(CONST.MSG.FIELD.PREFIX.DOCUMENT) == 0) {
        fieldsDataDocument(ds, msgData, childProperty, fields);
      }
    }
  }
}

function fieldsDataDirInner(ds, msgData, dirProperty, fields) {
  if (dirProperty.name.indexOf(CONST.MSG.FIELD.PREFIX.ATTACHMENT) == 0) {

    // attachment
    let attachmentField = {};
    fields.attachments.push(attachmentField);
    fieldsDataDir(ds, msgData, dirProperty, attachmentField);
  } else if (dirProperty.name.indexOf(CONST.MSG.FIELD.PREFIX.RECIPIENT) == 0) {

    // recipient
    let recipientField = {};
    fields.recipients.push(recipientField);
    fieldsDataDir(ds, msgData, dirProperty, recipientField);
  } else {

    // other dir
    let childFieldType = getFieldType(dirProperty);
    if (childFieldType != CONST.MSG.FIELD.DIR_TYPE.INNER_MSG) {
      fieldsDataDir(ds, msgData, dirProperty, fields);
    } else {
      // MSG as attachment currently isn't supported
      fields.innerMsgContent = true;
    }
  }
}

function isAddPropertyValue(fieldName, fieldTypeMapped) {
  return fieldName !== 'body' || fieldTypeMapped !== 'binary';
}

function fieldsDataDocument(ds, msgData, documentProperty, fields) {
  let value = documentProperty.name.substring(12).toLowerCase();
  let fieldClass = value.substring(0, 4);
  let fieldType = value.substring(4, 8);

  let fieldName = CONST.MSG.FIELD.NAME_MAPPING[fieldClass];
  let fieldTypeMapped = CONST.MSG.FIELD.TYPE_MAPPING[fieldType];

  if (fieldName) {
    let fieldValue = getFieldValue(ds, msgData, documentProperty, fieldTypeMapped);

    if (isAddPropertyValue(fieldName, fieldTypeMapped)) {
      fields[fieldName] = fieldValue;
    }
  }
  if (fieldClass == CONST.MSG.FIELD.CLASS_MAPPING.ATTACHMENT_DATA) {

    // attachment specific info
    fields['dataId'] = documentProperty.index;
    fields['contentLength'] = documentProperty.sizeBlock;
  }
}

function getFieldType(fieldProperty) {
  let value = fieldProperty.name.substring(12).toLowerCase();
  return value.substring(4, 8);
}

// extractor structure to manage bat/sbat block types and different data types
let extractorFieldValue = {
  sbat: {
    'extractor': function extractDataViaSbat(ds, msgData, fieldProperty, dataTypeExtractor) {
      let chain = getChainByBlockSmall(ds, msgData, fieldProperty);
      if (chain.length == 1) {
        return readDataByBlockSmall(ds, msgData, fieldProperty.startBlock, fieldProperty.sizeBlock, dataTypeExtractor);
      } else if (chain.length > 1) {
        return readChainDataByBlockSmall(ds, msgData, fieldProperty, chain, dataTypeExtractor);
      }
      return null;
    },
    dataType: {
      'string': function extractBatString(ds, msgData, blockStartOffset, bigBlockOffset, blockSize) {
        ds.seek(blockStartOffset + bigBlockOffset);
        return ds.readString(blockSize);
      },
      'unicode': function extractBatUnicode(ds, msgData, blockStartOffset, bigBlockOffset, blockSize) {
        ds.seek(blockStartOffset + bigBlockOffset);
        return ds.readUCS2String(blockSize / 2);
      },
      'binary': function extractBatBinary(ds, msgData, blockStartOffset, bigBlockOffset, blockSize) {
        ds.seek(blockStartOffset + bigBlockOffset);
        return ds.readUint8Array(blockSize);
      }
    }
  },
  bat: {
    'extractor': function extractDataViaBat(ds, msgData, fieldProperty, dataTypeExtractor) {
      let offset = getBlockOffsetAt(msgData, fieldProperty.startBlock);
      ds.seek(offset);
      return dataTypeExtractor(ds, fieldProperty);
    },
    dataType: {
      'string': function extractSbatString(ds, fieldProperty) {
        return ds.readString(fieldProperty.sizeBlock);
      },
      'unicode': function extractSbatUnicode(ds, fieldProperty) {
        return ds.readUCS2String(fieldProperty.sizeBlock / 2);
      },
      'binary': function extractSbatBinary(ds, fieldProperty) {
        return ds.readUint8Array(fieldProperty.sizeBlock);
      }
    }
  }
};

function readDataByBlockSmall(ds, msgData, startBlock, blockSize, dataTypeExtractor) {
  let byteOffset = startBlock * CONST.MSG.SMALL_BLOCK_SIZE;
  let bigBlockNumber = Math.floor(byteOffset / msgData.bigBlockSize);
  let bigBlockOffset = byteOffset % msgData.bigBlockSize;

  let rootProp = msgData.propertyData[0];

  let nextBlock = rootProp.startBlock;
  for (let i = 0; i < bigBlockNumber; i++) {
    nextBlock = getNextBlock(ds, msgData, nextBlock);
  }
  let blockStartOffset = getBlockOffsetAt(msgData, nextBlock);

  return dataTypeExtractor(ds, msgData, blockStartOffset, bigBlockOffset, blockSize);
}

function readChainDataByBlockSmall(ds, msgData, fieldProperty, chain, dataTypeExtractor) {
  let resultData = new Int8Array(fieldProperty.sizeBlock);

  for (let i = 0, idx = 0; i < chain.length; i++) {
    let data = readDataByBlockSmall(ds, msgData, chain[i], CONST.MSG.SMALL_BLOCK_SIZE, extractorFieldValue.sbat.dataType.binary);
    for (let j = 0; j < data.length; j++) {
      resultData[idx++] = data[j];
    }
  }
  let localDs = new DataStream(resultData, 0, DataStream.LITTLE_ENDIAN);
  return dataTypeExtractor(localDs, msgData, 0, 0, fieldProperty.sizeBlock);
}

function getChainByBlockSmall(ds, msgData, fieldProperty) {
  let blockChain = [];
  let nextBlockSmall = fieldProperty.startBlock;
  while (nextBlockSmall != CONST.MSG.END_OF_CHAIN) {
    blockChain.push(nextBlockSmall);
    nextBlockSmall = getNextBlockSmall(ds, msgData, nextBlockSmall);
  }
  return blockChain;
}

function getFieldValue(ds, msgData, fieldProperty, typeMapped) {
  let value = null;

  let valueExtractor =
    fieldProperty.sizeBlock < CONST.MSG.BIG_BLOCK_MIN_DOC_SIZE ? extractorFieldValue.sbat : extractorFieldValue.bat;
  let dataTypeExtractor = valueExtractor.dataType[typeMapped];

  if (dataTypeExtractor) {
    value = valueExtractor.extractor(ds, msgData, fieldProperty, dataTypeExtractor);
  }
  return value;
}

// MSG Reader
let MSGReader = function (arrayBuffer) {
  this.ds = new DataStream(arrayBuffer, 0, DataStream.LITTLE_ENDIAN);
};

MSGReader.prototype = {
  /**
   Converts bytes to fields information

   @return {Object} The fields data for MSG file
   */
  getFileData: function () {
    if (!isMSGFile(this.ds)) {
      return {error: 'Unsupported file type!'};
    }
    if (this.fileData == null) {
      this.fileData = parseMsgData(this.ds);
    }
    return this.fileData.fieldsData;
  },
  /**
   Reads an attachment content by key/ID

   @return {Object} The attachment for specific attachment key
   */
  getAttachment: function (attach) {
    let attachData = typeof attach === 'number' ? this.fileData.fieldsData.attachments[attach] : attach;
    let fieldProperty = this.fileData.propertyData[attachData.dataId];
    let fieldTypeMapped = CONST.MSG.FIELD.TYPE_MAPPING[getFieldType(fieldProperty)];
    let fieldData = getFieldValue(this.ds, this.fileData, fieldProperty, fieldTypeMapped);

    return {fileName: attachData.fileName, content: fieldData};
  }
};

// Export MSGReader for amd environments
if (typeof define === 'function' && define.amd) {
  define('MSGReader', [], function() {
    return MSGReader;
  });
}

// Export MSGReader for CommonJS
if (typeof module === 'object' && module && module.exports) {
  module.exports = MSGReader;
}

if (window) {
  window.MSGReader = MSGReader
}

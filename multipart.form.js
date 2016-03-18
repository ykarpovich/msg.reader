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
 * Example of Multipart form sender (submitting data as multipart/form-data content type)
 *
 * MSGReader msgReader = ...;
 * [...]
 * var attachment = msgReader.getAttachment(0);
 *
 * var mf = new MultipartForm('http://yourserver/service/upload', function (xhr) {
 *    if (xhr.readyState == XMLHttpRequest.DONE) {
 *        console.log('Sent');
 *    }
 * });
 *
 * mf.send({someData: 'Test data'}, [attachment]);
 */

(function () {

  var CRLF = "\r\n";

  function toBinary(value) {
    var nBytes = value.length;
    var ui8Data = new Uint8Array(nBytes);
    for (var nIdx = 0; nIdx < nBytes; nIdx++) {
      ui8Data[nIdx] = value.charCodeAt(nIdx) & 0xff;
    }
    return ui8Data;
  }

  function createBoundary() {
    return "--XHR----------------------" + (new Date()).getTime();
  }

  function createFieldsData(boundary, fieldsData) {
    var data = '';
    for (var fieldName in fieldsData) {
      if (!fieldsData.hasOwnProperty(fieldName)) {
        continue;
      }
      data += '--' + boundary + CRLF +
        'Content-Disposition: form-data; name="' + fieldName + '"' + CRLF + CRLF + fieldsData[fieldName] + CRLF;
    }
    return data;
  }

  function createFileHeader(boundary, fileName) {
    return '--' + boundary + CRLF +
      'Content-Disposition: form-data; name="file"; filename="' + encodeURIComponent(fileName) + '"' + CRLF +
      'Content-Type: application/octet-stream' + CRLF + CRLF
  }

  function createBinaryData(boundary, fieldsData, attachData) {
    var binaryData = [];

    binaryData.push(toBinary(createFieldsData(boundary, fieldsData)));
    for (var ai = 0; ai < attachData.length; ai++) {
      binaryData.push(toBinary(createFileHeader(boundary, attachData[ai].fileName)));
      binaryData.push(attachData[ai].content);
      binaryData.push(toBinary(CRLF));
    }
    binaryData.push(toBinary('--' + boundary + '--'));
    return binaryData;
  }

  function joinBinaryData(binaryData) {
    var binaryLength = 0, idx = 0, i = 0, bi = 0;
    for (bi = 0; bi < binaryData.length; bi++) {
      binaryLength += binaryData[bi].length;
    }
    var requestData = new Uint8Array(binaryLength);
    for (bi = 0; bi < binaryData.length; bi++) {
      for (i = 0; i < binaryData[bi].length; i++) {
        requestData[idx++] = binaryData[bi][i];
      }
    }
    return requestData;
  }

  function createRequestData(boundary, fieldsData, attachData) {
    var binaryData = createBinaryData(boundary, fieldsData, attachData);
    var requestData = joinBinaryData(binaryData);
    binaryData = null;
    return requestData;
  }

  // MultipartForm
  var MultipartForm = function (uploadUrl, readyStateChangeHandler) {
    this.uploadUrl = uploadUrl;
    this.readyStateChangeHandler = readyStateChangeHandler;
  };

  MultipartForm.prototype = {
    send: function (fieldsData, attachData) {
      var context = this;
      var xhr = new XMLHttpRequest();
      xhr.open('POST', context.uploadUrl);
      if (context.readyStateChangeHandler) {
        xhr.onreadystatechange = function () {
          context.readyStateChangeHandler(xhr)
        };
      }

      var boundary = createBoundary();
      xhr.setRequestHeader("Content-Type", "multipart/form-data; boundary=" + boundary);

      xhr.send(createRequestData(boundary, fieldsData, attachData));
    }
  };

  window.MultipartForm = MultipartForm;
})();
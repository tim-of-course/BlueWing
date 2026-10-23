cmake_minimum_required(VERSION 3.20)
project(bluewing_jxl LANGUAGES C CXX)
set(CMAKE_CXX_STANDARD 17)
set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
set(BUILD_TESTING OFF CACHE BOOL "" FORCE)
foreach(feature TOOLS DEVTOOLS DOXYGEN MANPAGES BENCHMARK EXAMPLES JNI SJPEG OPENEXR VIEWERS TCMALLOC PLUGINS TRANSCODE_JPEG WASM_THREADS)
  set(JPEGXL_ENABLE_${feature} OFF CACHE BOOL "" FORCE)
endforeach()
set(JPEGXL_ENABLE_SKCMS ON CACHE BOOL "" FORCE)
set(JPEGXL_BUNDLE_LIBPNG OFF CACHE BOOL "" FORCE)
set(JPEGXL_ENABLE_BOXES OFF CACHE BOOL "" FORCE)
add_subdirectory("${LIBJXL_SOURCE}" libjxl EXCLUDE_FROM_ALL)
add_executable(bluewing-jxl facade.cc)
target_link_libraries(bluewing-jxl PRIVATE jxl)
set_target_properties(bluewing-jxl PROPERTIES SUFFIX ".js")
target_link_options(bluewing-jxl PRIVATE
  -msimd128 --no-entry
  "--post-js=${CMAKE_CURRENT_SOURCE_DIR}/pointer-exports.js"
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createJxlModule
  -sENVIRONMENT=web,worker,node -sFILESYSTEM=0
  -sALLOW_MEMORY_GROWTH=1 -sMAXIMUM_MEMORY=4294967296
  -sINITIAL_MEMORY=33554432 -sSTACK_SIZE=1048576
  -sMALLOC=emmalloc -sABORTING_MALLOC=0
  "-sEXPORTED_RUNTIME_METHODS=['HEAPU8']"
  "-sEXPORTED_FUNCTIONS=['_malloc','_free','_bw_encode','_bw_encoded_data','_bw_encoded_size','_bw_encoded_free','_bw_decoder_new','_bw_decoder_delete','_bw_decoder_feed','_bw_decoder_flush','_bw_decoder_width','_bw_decoder_height','_bw_decoder_pixels','_bw_decoder_ratio']")
